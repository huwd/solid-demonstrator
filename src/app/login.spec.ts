import { expect, type Page, test } from "@playwright/test";

// A fictional person and identity provider, answered by Playwright inside
// the browser (decisions 0003 and 0015). The provider's login page is a
// stand-in with two links, so a test can allow or decline.
const alice = "https://alice.example/profile";
const issuer = "https://id.example";
const cors = { "access-control-allow-origin": "*" };

interface Provider {
  /** The authorization request the provider received, once it has. */
  readonly authorization: () => URL | null;
}

async function serveAlice(
  page: Page,
  discoveryExtra: Record<string, unknown> = {},
  answer: (request: URL) => URLSearchParams = (request) =>
    new URLSearchParams({
      code: "one-time-code-0123456789",
      state: request.searchParams.get("state") ?? "",
      iss: issuer,
    }),
): Promise<Provider> {
  let authorization: URL | null = null;
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
        ...discoveryExtra,
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
  return { authorization: () => authorization };
}

async function discoverAlice(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("WebID").fill(`${alice}#me`);
  await page.getByRole("button", { name: "Discover" }).click();
}

async function logIn(page: Page, choice: "Allow" | "Decline"): Promise<void> {
  await page.getByRole("button", { name: `Log in with ${issuer}` }).click();
  await page.getByRole("link", { name: choice }).click();
}

test("sends the person to their provider, and checks the response when they return", async ({
  page,
  baseURL,
}) => {
  const provider = await serveAlice(page);
  await discoverAlice(page);
  await expect(page.getByText(/The app will send you to https:\/\/id\.example/)).toBeVisible();

  await logIn(page, "Allow");

  await expect(page.getByText(`Back from ${issuer}`)).toBeVisible();
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
  // The entries from before the redirect are still there.
  // The profile and the provider before the redirect, then the trip there and back.
  await expect(timeline.getByRole("listitem")).toHaveCount(5);
  await expect(timeline).not.toContainText("one-time-code-0123456789");
});

test("explains when the person declines", async ({ page }) => {
  await serveAlice(page);
  await discoverAlice(page);
  await logIn(page, "Decline");
  await expect(page.getByRole("alert")).toContainText("You didn't allow the app");
});

test("refuses a response to a different login", async ({ page }) => {
  await serveAlice(
    page,
    {},
    () => new URLSearchParams({ code: "c", state: "not-the-app's", iss: issuer }),
  );
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
    client_id_metadata_document_supported: false,
    registration_endpoint: `${issuer}/register`,
  });
  await discoverAlice(page);
  await expect(page.getByText(/doesn't read Client ID Documents/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Log in/ })).toHaveCount(0);
});
