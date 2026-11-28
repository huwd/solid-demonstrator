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
    await expect(entry.getByText("Seen by the app", { exact: true })).toBeVisible();
  }
  await expect(entries.nth(0)).toContainText("As expected");
});

test("opens an entry to show the request and response, with what each part is for", async ({
  page,
}) => {
  await discoverAlice(page);

  await page.locator("trace-timeline li").first().getByRole("button").click();
  const detail = page
    .locator("trace-timeline")
    .getByRole("complementary", { name: "The selected step" });
  await expect(detail).toContainText(`GET ${alice}`);
  await expect(detail).toContainText("accept: text/turtle");
  await expect(detail).toContainText("The formats the app will take, best first.");
  await expect(detail).toContainText("200 OK");
  await expect(detail).toContainText("solid:oidcIssuer <https://id.example>");
  await expect(detail.getByRole("link", { name: "The specification for this step" })).toBeVisible();
  await expect(page.locator("trace-timeline li").first()).toHaveAttribute("aria-current", "step");
});

test("marks the exchange that wasn't as expected, saying why", async ({ page }) => {
  await discoverAlice(page);

  const gone = page.locator("trace-timeline li.unexpected");
  await expect(gone).toHaveCount(1);
  await expect(gone).toContainText("Not as expected");
  await gone.getByRole("button").click();
  const detail = page
    .locator("trace-timeline")
    .getByRole("complementary", { name: "The selected step" });
  await expect(detail).toContainText("Expected 200 OK. Got 404");
  await expect(detail).toContainText("GET https://gone.example/.well-known/openid-configuration");
});

test("follows the newest step, and steps back and forth through the journey", async ({ page }) => {
  await discoverAlice(page);

  const timeline = page.locator("trace-timeline");
  const controls = timeline.getByRole("group", { name: "Step through the journey" });
  await expect(controls).toContainText("Step 3 of 3");
  await expect(controls.getByRole("checkbox", { name: "Follow new steps" })).toBeChecked();
  await expect(controls.getByRole("button", { name: "Next step" })).toBeDisabled();

  await controls.getByRole("button", { name: "Previous step" }).click();
  await expect(controls).toContainText("Step 2 of 3");
  await expect(controls.getByRole("checkbox", { name: "Follow new steps" })).not.toBeChecked();
  await expect(timeline.locator("li").nth(1)).toHaveAttribute("aria-current", "step");

  await controls.getByRole("checkbox", { name: "Follow new steps" }).check();
  await expect(controls).toContainText("Step 3 of 3");
});

test("groups the steps into chapters, and maps the parties found", async ({ page }) => {
  await discoverAlice(page);

  const timeline = page.locator("trace-timeline");
  const discovery = timeline.getByRole("region", { name: "Finding the servers" });
  await expect(discovery).toContainText("3 steps. 1 went other than expected.");
  const map = timeline.locator("journey-map");
  await expect(map).toContainText("Found so far: your WebID profile and 2 identity providers.");
  await expect(map.getByRole("img")).toHaveAttribute("aria-label", /2 identity providers/);
  await expect(map.locator('[data-party="pod"]')).toHaveClass(/expected/);

  // Clicking a line on the map moves the cursor to its latest step.
  await map.locator('[data-line="app>webid-profile:seen"] .hit').click({ force: true });
  await expect(timeline.getByRole("group", { name: "Step through the journey" })).toContainText(
    "Step 1 of 3",
  );
});
