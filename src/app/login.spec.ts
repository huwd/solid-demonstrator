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
}

interface Options {
  readonly discovery?: Record<string, unknown>;
  readonly answer?: (request: URL) => URLSearchParams;
  /** Replaces the token response's fields. */
  readonly tokens?: Record<string, unknown>;
  readonly tokenStatus?: number;
  /** The profile from the second fetch on, when the app checks the token's WebID. */
  readonly profileAfterLogin?: string;
}

const profile = `<#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .`;

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
  return { authorization: () => authorization, tokenRequests };
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
  // back, the exchange, then the profile again and the Pod's check.
  await expect(timeline.getByRole("listitem")).toHaveCount(8);
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
  await expect(inspector).not.toContainText("eyJ");
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
