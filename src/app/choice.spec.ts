import { expect, type Page, test } from "@playwright/test";

// Fictional servers, answered by Playwright inside the browser (decision 0003).
const alice = "https://alice.example/profile";
const cors = { "access-control-allow-origin": "*" };

async function serve(page: Page, issuers: string[], storages: string[]): Promise<void> {
  const statements = [
    ...issuers.map((issuer) => `<http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}>`),
    ...storages.map((storage) => `<http://www.w3.org/ns/pim/space#storage> <${storage}>`),
  ];
  await page.route(alice, (route) =>
    route.fulfill({
      headers: { ...cors, "content-type": "text/turtle" },
      body: `<#me> ${statements.join(" ;\n")} .`,
    }),
  );
  await page.route("https://*.example/.well-known/openid-configuration", (route) => {
    const issuer = new URL(route.request().url()).origin;
    if (issuer === "https://gone.example") {
      return route.fulfill({ status: 404, headers: cors, body: "" });
    }
    return route.fulfill({
      headers: cors,
      json: {
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        scopes_supported: ["webid"],
        code_challenge_methods_supported: ["S256"],
        dpop_signing_alg_values_supported: ["ES256"],
        client_id_metadata_document_supported: true,
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("WebID").fill(`${alice}#me`);
  await page.getByRole("button", { name: "Discover" }).click();
  await expect(page.getByRole("heading", { name: "What the profile says" })).toBeVisible();
}

test("offers a choice of the providers that can be used, chosen by the person", async ({
  page,
}) => {
  await serve(
    page,
    ["https://one.example", "https://two.example", "https://gone.example"],
    ["https://pod.example/"],
  );

  const providers = page.getByRole("group", {
    name: "Which identity provider do you want to log in with?",
  });
  await expect(providers.getByRole("radio")).toHaveCount(2);
  await expect(providers.getByRole("radio", { name: "https://gone.example" })).toHaveCount(0);
  await expect(providers.getByRole("radio", { checked: true })).toHaveCount(0);

  await providers.getByRole("radio", { name: "https://two.example" }).check();
  await expect(providers.getByRole("radio", { name: "https://two.example" })).toBeChecked();
});

test("offers a choice of Pods, and lets the person switch", async ({ page }) => {
  await serve(
    page,
    ["https://one.example"],
    ["https://pod-one.example/", "https://pod-two.example/"],
  );

  const pods = page.getByRole("group", { name: "Which Pod do you want to use?" });
  await pods.getByRole("radio", { name: "https://pod-one.example/" }).check();
  await pods.getByRole("radio", { name: "https://pod-two.example/" }).check();
  await expect(pods.getByRole("radio", { name: "https://pod-two.example/" })).toBeChecked();
  await expect(pods.getByRole("radio", { name: "https://pod-one.example/" })).not.toBeChecked();
});

test("asks nothing when there's only one of each", async ({ page }) => {
  await serve(page, ["https://one.example", "https://gone.example"], ["https://pod.example/"]);

  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText("Ready for login")).toBeVisible();
});
