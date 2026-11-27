import { createHash } from "node:crypto";
import { expect, type Page, type Request, test } from "@playwright/test";
import { signTestJwt } from "../core/test-support/tokens.ts";

// A fictional person and identity provider, answered by Playwright inside
// the browser (decisions 0003 and 0015). The provider's login page is a
// stand-in with two links, so a test can allow or decline, and its token
// endpoint signs real tokens with a test key.
const alice = "https://alice.example/profile";
const issuer = "https://id.example";
const cors = { "access-control-allow-origin": "*" };

interface Provider {
  /** The authorization request the provider received, once it has. */
  readonly authorization: () => URL | null;
  /** The token requests the provider received. */
  readonly tokenRequests: readonly Request[];
  /** The requests the Pod accepted. */
  readonly podRequests: readonly Request[];
}

interface Options {
  readonly discovery?: Record<string, unknown>;
  readonly answer?: (request: URL) => URLSearchParams;
  /** Replaces the token response's fields. */
  readonly tokens?: Record<string, unknown>;
  readonly tokenStatus?: number;
  /** The profile from the second fetch on, when the app checks the token's WebID. */
  readonly profileAfterLogin?: string;
  /** The Pod's containers, by URL, as Turtle; each defaults to an empty container. */
  readonly pod?: Record<
    string,
    {
      readonly status?: number;
      readonly body?: string;
      readonly wacAllow?: string;
      readonly contentType?: string;
      readonly etag?: string;
    }
  >;
}

const pod = "https://pod.example/alice/";
const profile = `<#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> ;
  <http://www.w3.org/ns/pim/space#storage> <${pod}> .`;

/** The RFC 7638 thumbprint of the key in a DPoP proof, as a provider binds a token to it. */
function proofThumbprint(proof: string): string {
  const header = JSON.parse(Buffer.from(proof.split(".")[0] ?? "", "base64url").toString());
  const { crv, kty, x, y } = header.jwk;
  return createHash("sha256").update(JSON.stringify({ crv, kty, x, y })).digest("base64url");
}

const answerWithCode = (request: URL) =>
  new URLSearchParams({
    code: "one-time-code-0123456789",
    state: request.searchParams.get("state") ?? "",
    iss: issuer,
  });

async function serveAlice(page: Page, options: Options = {}): Promise<Provider> {
  const answer = options.answer ?? answerWithCode;
  let authorization: URL | null = null;
  const tokenRequests: Request[] = [];
  const podRequests: Request[] = [];
  let profileFetches = 0;
  await page.route(alice, (route) => {
    profileFetches += 1;
    return route.fulfill({
      headers: { ...cors, "content-type": "text/turtle" },
      body: profileFetches > 1 ? (options.profileAfterLogin ?? profile) : profile,
    });
  });
  await page.route(`${issuer}/.well-known/openid-configuration`, (route) =>
    route.fulfill({
      headers: cors,
      json: {
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        scopes_supported: ["openid", "webid"],
        code_challenge_methods_supported: ["S256"],
        dpop_signing_alg_values_supported: ["ES256"],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        id_token_signing_alg_values_supported: ["ES256"],
        ...options.discovery,
      },
    }),
  );
  await page.route(`${issuer}/auth?*`, (route) => {
    const request = new URL(route.request().url());
    authorization = request;
    const redirect = request.searchParams.get("redirect_uri") ?? "";
    const allow = `${redirect}?${answer(request)}`;
    const decline = `${redirect}?${new URLSearchParams({
      error: "access_denied",
      state: request.searchParams.get("state") ?? "",
      iss: issuer,
    })}`;
    return route.fulfill({
      headers: { "content-type": "text/html" },
      body: `<!doctype html><title>Log in</title><a href="${allow}">Allow</a> <a href="${decline}">Decline</a>`,
    });
  });
  await page.route(`${issuer}/token`, async (route) => {
    tokenRequests.push(route.request());
    const now = Math.floor(Date.now() / 1000);
    const sent = authorization?.searchParams;
    const body = {
      access_token: await signTestJwt({
        webid: webId,
        aud: "solid",
        client_id: sent?.get("client_id"),
        exp: now + 300,
        cnf: { jkt: proofThumbprint(route.request().headers()["dpop"] ?? "") },
      }),
      id_token: await signTestJwt({
        aud: sent?.get("client_id"),
        sub: webId,
        webid: webId,
        nonce: sent?.get("nonce"),
        iat: now,
        exp: now + 300,
      }),
      token_type: "DPoP",
      expires_in: 300,
      ...options.tokens,
    };
    return route.fulfill({ status: options.tokenStatus ?? 200, headers: cors, json: body });
  });
  await page.route(`${pod}**`, (route) => {
    const request = route.request();
    const headers = request.headers();
    // A Pod refuses a request without a DPoP-bound token and a proof.
    if (!headers["authorization"]?.startsWith("DPoP ") || headers["dpop"] === undefined) {
      return route.fulfill({ status: 401, headers: cors, body: "" });
    }
    podRequests.push(request);
    const answer = options.pod?.[request.url()] ?? {};
    return route.fulfill({
      status: answer.status ?? 200,
      headers: {
        ...cors,
        "content-type": "text/turtle",
        // The browser hides WAC-Allow from the app unless the Pod exposes it, as real Pods do.
        "access-control-expose-headers": "WAC-Allow, ETag",
        ...(answer.contentType === undefined ? {} : { "content-type": answer.contentType }),
        ...(answer.etag === undefined ? {} : { etag: answer.etag }),
        ...(answer.wacAllow === undefined ? {} : { "wac-allow": answer.wacAllow }),
      },
      body: answer.body ?? "<> a <http://www.w3.org/ns/ldp#BasicContainer> .",
    });
  });
  return { authorization: () => authorization, tokenRequests, podRequests };
}

const webId = `${alice}#me`;

async function discoverAlice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("WebID").fill(`${alice}#me`);
  await page.getByRole("button", { name: "Discover" }).click();
}

async function logIn(page: Page, choice: "Allow" | "Decline"): Promise<void> {
  await page.getByRole("button", { name: `Log in with ${issuer}` }).click();
  await page.getByRole("link", { name: choice }).click();
}

test("logs the person in, through their provider, with a DPoP-bound token", async ({
  page,
  baseURL,
}) => {
  const provider = await serveAlice(page);
  await discoverAlice(page);
  await expect(page.getByText(/The app will send you to https:\/\/id\.example/)).toBeVisible();

  await logIn(page, "Allow");

  await expect(page.getByText(`Logged in as ${webId}`)).toBeVisible();
  await expect(page.getByText(/bound to its DPoP key, which expires at/)).toBeVisible();
  expect(new URL(page.url()).search, "the code is removed from the address").toBe("");

  const sent = provider.authorization();
  expect(sent).not.toBeNull();
  const parameters = Object.fromEntries(sent?.searchParams ?? []);
  expect(parameters).toMatchObject({
    response_type: "code",
    client_id: `${baseURL}/clientid.jsonld`,
    redirect_uri: `${baseURL}/`,
    scope: "openid webid",
    code_challenge_method: "S256",
    prompt: "consent",
  });

  const timeline = page.locator("trace-timeline");
  await expect(timeline.getByText("Reconstructed", { exact: true })).toHaveCount(2);
  await expect(timeline.getByText("Explained, not observed", { exact: true })).toHaveCount(1);
  // The profile and the provider before the redirect, the trip there and
  // back, the exchange, the profile again and the Pod's check, then the Pod.
  await expect(timeline.getByRole("listitem")).toHaveCount(9);
  await expect(timeline.getByText("Repeated", { exact: true })).toHaveCount(1);
  await expect(timeline).not.toContainText("one-time-code-0123456789");

  const [exchange] = provider.tokenRequests;
  expect(exchange?.method()).toBe("POST");
  expect(exchange?.headers()["dpop"]).toMatch(/^ey[\w-]+\.[\w-]+\.[\w-]+$/);
  expect(new URLSearchParams(exchange?.postData() ?? "").get("grant_type")).toBe(
    "authorization_code",
  );
});

test("keeps one non-extractable DPoP key, and uses it again on the next login", async ({
  page,
}) => {
  const provider = await serveAlice(page);
  for (let login = 0; login < 2; login += 1) {
    await discoverAlice(page);
    await logIn(page, "Allow");
    await expect(page.getByText(`Logged in as ${webId}`)).toBeVisible();
  }
  const keys = provider.tokenRequests.map((request) => {
    const header = (request.headers()["dpop"] ?? "").split(".")[0] ?? "";
    return JSON.parse(Buffer.from(header, "base64url").toString()).jwk;
  });
  expect(keys).toHaveLength(2);
  expect(keys[1]).toEqual(keys[0]);

  const stored = await page.evaluate(
    () =>
      new Promise<boolean | null>((resolve) => {
        const opening = indexedDB.open("solid-demonstrator");
        opening.onsuccess = () => {
          const read = opening.result.transaction("keys").objectStore("keys").get("dpop");
          read.onsuccess = () => resolve(read.result?.privateKey?.extractable ?? null);
        };
      }),
  );
  expect(stored, "the private key can't be exported").toBe(false);
});

test("explains when the provider won't exchange the code", async ({ page }) => {
  await serveAlice(page, { tokenStatus: 400, tokens: { error: "invalid_grant" } });
  await discoverAlice(page);
  await logIn(page, "Allow");
  await expect(page.getByRole("alert")).toContainText("wouldn't exchange the code");
});

test("refuses a token that isn't bound to the key", async ({ page }) => {
  await serveAlice(page, { tokens: { token_type: "Bearer" } });
  await discoverAlice(page);
  await logIn(page, "Allow");
  await expect(page.getByRole("alert")).toContainText("isn't bound to the app's key");
});

test("explains when the person declines", async ({ page }) => {
  await serveAlice(page);
  await discoverAlice(page);
  await logIn(page, "Decline");
  await expect(page.getByRole("alert")).toContainText("You didn't allow the app");
});

test("refuses a response to a different login", async ({ page }) => {
  await serveAlice(page, {
    answer: () => new URLSearchParams({ code: "c", state: "not-the-app's", iss: issuer }),
  });
  await discoverAlice(page);
  await logIn(page, "Allow");
  await expect(page.getByRole("alert")).toContainText("doesn't match the login the app started");
});

test("refuses a response when this tab started no login", async ({ page }) => {
  await page.goto(`/?code=c&state=s&iss=${encodeURIComponent(issuer)}`);
  await expect(page.getByRole("alert")).toContainText("No login was started in this tab");
  expect(new URL(page.url()).search).toBe("");
});

test("registers first with a provider that doesn't read Client ID Documents", async ({ page }) => {
  const registrations: unknown[] = [];
  await page.route(`${issuer}/register`, (route) => {
    registrations.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      headers: cors,
      json: { client_id: "registered-client", registration_access_token: "registration-secret" },
    });
  });
  const provider = await serveAlice(page, {
    discovery: {
      client_id_metadata_document_supported: false,
      registration_endpoint: `${issuer}/register`,
    },
  });
  await discoverAlice(page);
  await expect(page.getByText(/a registered name is only what the app claims/)).toBeVisible();

  await logIn(page, "Allow");

  await expect(page.getByText(`Logged in as ${webId}`)).toBeVisible();
  expect(provider.authorization()?.searchParams.get("client_id")).toBe("registered-client");
  expect(registrations).toEqual([
    expect.objectContaining({
      client_name: "Solid Demonstrator",
      token_endpoint_auth_method: "none",
    }),
  ]);
  await expect(page.locator("trace-timeline")).not.toContainText("registration-secret");
});

async function serveRegistration(page: Page): Promise<unknown[]> {
  const registrations: unknown[] = [];
  await page.route(`${issuer}/register`, (route) => {
    registrations.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      headers: cors,
      json: { client_id: `registered-client-${registrations.length}` },
    });
  });
  return registrations;
}

const registrationOnly = {
  client_id_metadata_document_supported: false,
  registration_endpoint: `${issuer}/register`,
};

test("registers once per provider in a tab, and says so when it uses it again", async ({
  page,
}) => {
  const registrations = await serveRegistration(page);
  const provider = await serveAlice(page, { discovery: registrationOnly });
  for (let login = 0; login < 2; login += 1) {
    await discoverAlice(page);
    await logIn(page, "Allow");
    await expect(page.getByText(`Logged in as ${webId}`)).toBeVisible();
  }
  expect(registrations).toHaveLength(1);
  expect(provider.authorization()?.searchParams.get("client_id")).toBe("registered-client-1");
  await expect(
    page
      .locator("trace-timeline")
      .getByText(/which https:\/\/id\.example gave the app earlier in this tab/),
  ).toHaveCount(1);
});

test("registers again when the provider no longer recognises the app", async ({ page }) => {
  const registrations = await serveRegistration(page);
  let refuse = true;
  await serveAlice(page, {
    discovery: registrationOnly,
    answer: (request) => {
      const state = request.searchParams.get("state") ?? "";
      const answer = refuse
        ? { error: "unauthorized_client", state, iss: issuer }
        : { code: "one-time-code-0123456789", state, iss: issuer };
      refuse = false;
      return new URLSearchParams(answer);
    },
  });
  await discoverAlice(page);
  await logIn(page, "Allow");
  await expect(page.getByRole("alert")).toContainText("returned an error");

  await discoverAlice(page);
  await logIn(page, "Allow");
  await expect(page.getByText(`Logged in as ${webId}`)).toBeVisible();
  expect(registrations).toHaveLength(2);
});

test("explains when the provider won't register the app", async ({ page }) => {
  await page.route(`${issuer}/register`, (route) =>
    route.fulfill({ status: 400, headers: cors, json: { error: "invalid_client_metadata" } }),
  );
  await serveAlice(page, {
    discovery: {
      client_id_metadata_document_supported: false,
      registration_endpoint: `${issuer}/register`,
    },
  });
  await discoverAlice(page);
  await page.getByRole("button", { name: `Log in with ${issuer}` }).click();
  await expect(page.getByRole("alert")).toContainText(`${issuer} wouldn't register the app`);
  await expect(page.getByRole("button", { name: `Log in with ${issuer}` })).toBeEnabled();
});

test("identifies itself with its Client ID Document where the provider reads one", async ({
  page,
  baseURL,
}) => {
  await serveAlice(page);
  await discoverAlice(page);
  await expect(page.getByRole("link", { name: "Client ID Document" })).toHaveAttribute(
    "href",
    `${baseURL}/clientid.jsonld`,
  );
});

test("shows what the tokens say, and repeats the Pod's check of the WebID", async ({
  page,
  baseURL,
}) => {
  await serveAlice(page);
  await discoverAlice(page);
  await logIn(page, "Allow");

  const inspector = page.locator("token-inspector");
  await expect(inspector.getByText("The access token is bound to the app's key")).toBeVisible();
  await expect(inspector.getByText(`The WebID's profile names ${issuer}`)).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "Access token" })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "ID token" })).toBeVisible();
  await expect(inspector.getByText(`${baseURL}/clientid.jsonld`).first()).toBeVisible();
  await expect(inspector.getByText(webId).first()).toBeVisible();
  // No JWT: a header and claims, each base64url JSON. A bare "eyJ" can turn up
  // by chance, where a label meets a random key thumbprint.
  await expect(inspector).not.toContainText(/eyJ[\w-]+\.eyJ[\w-]+/);
});

test("warns when the WebID's profile doesn't name the provider", async ({ page }) => {
  await serveAlice(page, {
    profileAfterLogin: `<#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://other.example> .`,
  });
  await discoverAlice(page);
  await logIn(page, "Allow");
  const alert = page.locator("token-inspector").getByRole("alert");
  await expect(alert).toContainText(`The profile doesn't name ${issuer}`);
  await expect(alert).toContainText("A Pod would refuse this token");
});

test("warns when the access token is bound to another key", async ({ page }) => {
  await serveAlice(page, {
    tokens: {
      access_token: await signTestJwt({ webid: webId, cnf: { jkt: "someone-elses-key" } }),
    },
  });
  await discoverAlice(page);
  await logIn(page, "Allow");
  await expect(page.locator("token-inspector").getByRole("alert")).toContainText(
    "bound to a different key",
  );
});

test("logs out, forgetting the session, key, stored values and timeline", async ({ page }) => {
  const registrations = await serveRegistration(page);
  const provider = await serveAlice(page, { discovery: registrationOnly });
  await discoverAlice(page);
  await logIn(page, "Allow");
  await expect(page.getByText(`Logged in as ${webId}`)).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();

  await expect(page.getByText("Logged out", { exact: true })).toBeVisible();
  await expect(page.getByText(/log out on https:\/\/id\.example's own site/)).toBeVisible();
  await expect(page.getByText(`Logged in as ${webId}`)).toHaveCount(0);
  await expect(page.locator("trace-timeline")).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  const key = await page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const opening = indexedDB.open("solid-demonstrator");
        opening.onsuccess = () => {
          const read = opening.result.transaction("keys").objectStore("keys").get("dpop");
          read.onsuccess = () => resolve(read.result ?? null);
        };
      }),
  );
  expect(key, "the DPoP key is deleted").toBeNull();

  // The next login starts afresh: a new registration and a new key.
  await discoverAlice(page);
  await logIn(page, "Allow");
  await expect(page.getByText(`Logged in as ${webId}`)).toBeVisible();
  expect(registrations).toHaveLength(2);
  const keys = provider.tokenRequests.map((request) => {
    const header = (request.headers()["dpop"] ?? "").split(".")[0] ?? "";
    return JSON.parse(Buffer.from(header, "base64url").toString()).jwk;
  });
  expect(keys[1]).not.toEqual(keys[0]);
});

test("browses the Pod as the logged-in person, a folder at a time", async ({ page }) => {
  const provider = await serveAlice(page, {
    pod: {
      [pod]: {
        wacAllow: 'user="read write append control",public="read"',
        body: `<> a <http://www.w3.org/ns/ldp#BasicContainer> ;
          <http://www.w3.org/ns/ldp#contains> <notes/>, <hello.txt>, <private/> .
          <hello.txt> <http://www.w3.org/ns/posix/stat#size> 12 .`,
      },
      [`${pod}notes/`]: {
        wacAllow: 'user="read",public=""',
        body: `<> a <http://www.w3.org/ns/ldp#BasicContainer> ; <http://www.w3.org/ns/ldp#contains> <shopping.txt> .`,
      },
      [`${pod}private/`]: { status: 403, body: "" },
    },
  });
  await discoverAlice(page);
  await logIn(page, "Allow");

  const browser = page.locator("pod-browser");
  await expect(browser.getByRole("heading", { name: "Your Pod" })).toBeVisible();
  await expect(
    browser.getByText("Here you may: read, write, append, control. Everyone may: read."),
  ).toBeVisible();
  await expect(browser.getByText("hello.txt")).toBeVisible();
  await expect(browser.getByText("(12 bytes)")).toBeVisible();

  await browser.getByRole("button", { name: "notes/" }).click();
  await expect(browser.getByText("shopping.txt")).toBeVisible();
  await expect(browser.getByText("Here you may: read. Everyone may: nothing.")).toBeVisible();
  await expect(browser.getByRole("navigation", { name: "Where you are" })).toContainText("notes");

  await browser.getByRole("button", { name: "alice" }).click();
  await browser.getByRole("button", { name: "private/" }).click();
  await expect(browser.getByRole("alert")).toContainText("You aren't allowed to read this");
  await expect(browser.getByRole("alert")).toContainText("knows who you are");

  // Every request carried the token and its own proof, for its own URL.
  const proofs = provider.podRequests.map((request) => {
    const payload = (request.headers()["dpop"] ?? "").split(".")[1] ?? "";
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  });
  expect(proofs.map((proof) => proof.htu)).toEqual([pod, `${pod}notes/`, pod, `${pod}private/`]);
  expect(new Set(proofs.map((proof) => proof.jti)).size).toBe(4);
});

test("opens a file in the Pod, showing text as text", async ({ page }) => {
  const provider = await serveAlice(page, {
    pod: {
      [pod]: {
        body: `<> a <http://www.w3.org/ns/ldp#BasicContainer> ;
          <http://www.w3.org/ns/ldp#contains> <hello.txt>, <cat.png>, <secret.txt> .`,
      },
      [`${pod}hello.txt`]: {
        contentType: "text/plain",
        etag: '"v1"',
        wacAllow: 'user="read write",public=""',
        body: "Hello <script>window.ran = true</script>",
      },
      [`${pod}cat.png`]: { contentType: "image/png", body: "not really a picture" },
      [`${pod}secret.txt`]: { status: 403, body: "" },
    },
  });
  await discoverAlice(page);
  await logIn(page, "Allow");
  const browser = page.locator("pod-browser");

  await browser.getByRole("button", { name: "hello.txt" }).click();
  const content = browser.getByLabel("Content of hello.txt");
  await expect(content).toHaveText("Hello <script>window.ran = true</script>");
  expect(await page.evaluate(() => "ran" in window)).toBe(false);
  await expect(browser.getByText(`Its ETag, this version's name, is "v1".`)).toBeVisible();
  await expect(
    browser.getByText("Here you may: read, write. Everyone may: nothing."),
  ).toBeVisible();

  await browser.getByRole("button", { name: "Back to alice" }).click();
  await browser.getByRole("button", { name: "cat.png" }).click();
  await expect(browser.getByText(/doesn't show this resource's content/)).toBeVisible();

  await browser.getByRole("button", { name: "Back to alice" }).click();
  await browser.getByRole("button", { name: "secret.txt" }).click();
  await expect(browser.getByRole("alert")).toContainText("You aren't allowed to read this");

  const proofs = provider.podRequests.map((request) => {
    const payload = (request.headers()["dpop"] ?? "").split(".")[1] ?? "";
    return JSON.parse(Buffer.from(payload, "base64url").toString()).htu;
  });
  expect(proofs).toEqual([pod, `${pod}hello.txt`, `${pod}cat.png`, `${pod}secret.txt`]);
});
