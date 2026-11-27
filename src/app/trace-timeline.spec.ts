import { expect, type Page, test } from "@playwright/test";

// Fictional servers, answered by Playwright inside the browser (decision 0003).
const alice = "https://alice.example/profile";
const cors = { "access-control-allow-origin": "*" };
const profile = `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
<#me> solid:oidcIssuer <https://id.example>, <https://gone.example> .`;

async function discoverAlice(page: Page): Promise<void> {
  await page.route(alice, (route) =>
    route.fulfill({ headers: { ...cors, "content-type": "text/turtle" }, body: profile }),
  );
  await page.route("https://id.example/.well-known/openid-configuration", (route) =>
    route.fulfill({
      headers: cors,
      json: {
        issuer: "https://id.example",
        authorization_endpoint: "https://id.example/auth",
        token_endpoint: "https://id.example/token",
        jwks_uri: "https://id.example/jwks",
        scopes_supported: ["webid"],
        code_challenge_methods_supported: ["S256"],
        dpop_signing_alg_values_supported: ["ES256"],
        client_id_metadata_document_supported: true,
      },
    }),
  );
  await page.route("https://gone.example/.well-known/openid-configuration", (route) =>
    route.fulfill({ status: 404, headers: cors, body: "" }),
  );
  await page.goto("/");
  await page.getByLabel("WebID").fill(`${alice}#me`);
  await page.getByRole("button", { name: "Discover" }).click();
}

test("shows nothing until a WebID is looked up", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Every exchange so far" })).toHaveCount(0);
});

test("lists every exchange in order, labelled with how it's known", async ({ page }) => {
  await discoverAlice(page);

  const entries = page.locator("trace-timeline li");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("1. This app → WebID profile");
  await expect(entries.nth(1)).toContainText("This app → Identity provider");
  await expect(entries.nth(2)).toContainText("This app → Identity provider");
  for (const entry of await entries.all()) {
    await expect(entry.getByText("Seen", { exact: true })).toBeVisible();
  }
  await expect(entries.nth(0)).toContainText("As expected");
});

test("opens an entry to show the request and response", async ({ page }) => {
  await discoverAlice(page);

  const first = page.locator("trace-timeline li").first();
  await first.locator("summary").click();
  await expect(first).toContainText(`GET ${alice}`);
  await expect(first).toContainText("accept: text/turtle");
  await expect(first).toContainText("200 OK");
  await expect(first).toContainText("solid:oidcIssuer <https://id.example>");
  await expect(first.getByRole("link", { name: "The specification for this step" })).toBeVisible();
});

test("marks the exchange that wasn't as expected, saying why", async ({ page }) => {
  await discoverAlice(page);

  const gone = page.locator("trace-timeline li.unexpected");
  await expect(gone).toHaveCount(1);
  await expect(gone).toContainText("Not as expected");
  await gone.locator("summary").click();
  await expect(gone).toContainText("Expected 200 OK. Got 404");
  await expect(gone).toContainText("GET https://gone.example/.well-known/openid-configuration");
});
