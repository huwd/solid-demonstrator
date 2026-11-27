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
  await page.route(alice, (route) =>
    route.fulfill({
      headers: { ...cors, "content-type": "text/turtle" },
      body: `<#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .`,
    }),
  );
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
      access_token: await signTestJwt({ webid: webId, exp: now + 300 }),
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
  // back, then the exchange.
  await expect(timeline.getByRole("listitem")).toHaveCount(6);
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

test("explains a provider that would need the app to register first", async ({ page }) => {
  await serveAlice(page, {
    discovery: {
      client_id_metadata_document_supported: false,
      registration_endpoint: `${issuer}/register`,
    },
  });
  await discoverAlice(page);
  await expect(page.getByText(/doesn't read Client ID Documents/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Log in/ })).toHaveCount(0);
});
