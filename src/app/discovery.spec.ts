import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, type Route, test } from "@playwright/test";

// Fictional servers, answered by Playwright inside the browser, so the tests
// never depend on a live profile or provider (decision 0003).
const alice = "https://alice.example/profile";
const wellKnown = "/.well-known/openid-configuration";

const cors = { "access-control-allow-origin": "*" };

function turtle(route: Route, body: string): Promise<void> {
  return route.fulfill({ headers: { ...cors, "content-type": "text/turtle" }, body });
}

function discovery(issuer: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    scopes_supported: ["openid", "webid"],
    code_challenge_methods_supported: ["S256"],
    dpop_signing_alg_values_supported: ["ES256"],
    client_id_metadata_document_supported: true,
    ...extra,
  };
}

async function serveProvider(page: Page, origin: string, document: Record<string, unknown>) {
  await page.route(`${origin}${wellKnown}`, (route) =>
    route.fulfill({ headers: cors, json: document }),
  );
}

async function discoverWebId(page: Page, webId: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("WebID").fill(webId);
  await page.getByRole("button", { name: "Discover" }).click();
}

test("asks for a WebID when none is entered, without fetching anything", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  const before = requests.length;

  await page.getByRole("button", { name: "Discover" }).click();

  await expect(page.getByText("Enter a WebID.")).toBeVisible();
  await expect(page.getByLabel("WebID")).toHaveAttribute("aria-invalid", "true");
  expect(requests.length).toBe(before);
});

test("shows the profile and a provider that's ready for login", async ({ page }) => {
  await page.route(alice, (route) =>
    turtle(
      route,
      `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
       @prefix pim: <http://www.w3.org/ns/pim/space#> .
       <#me> <http://xmlns.com/foaf/0.1/name> "Alice" ;
         solid:oidcIssuer <https://id.example> ;
         pim:storage <https://pod.example/alice/> .`,
    ),
  );
  await serveProvider(page, "https://id.example", discovery("https://id.example"));

  await discoverWebId(page, `${alice}#me`);

  await expect(page.getByRole("heading", { name: "What the profile says" })).toBeVisible();
  await expect(page.getByText("Alice", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://pod.example/alice/" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "https://id.example" })).toBeVisible();
  await expect(page.getByText("Ready for login")).toBeVisible();
  await expect(page.getByText(/accepts a Client ID Document/)).toBeVisible();
});

test("explains each provider that can't be used, and what the profile lacks", async ({ page }) => {
  await page.route(alice, (route) =>
    turtle(
      route,
      `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
       <#me> solid:oidcIssuer <https://bare.example>, <https://slash.example> ;
         <http://www.w3.org/ns/pim/space#storage> <javascript:alert(1)> .`,
    ),
  );
  await serveProvider(page, "https://bare.example", {
    issuer: "https://bare.example",
    authorization_endpoint: "https://bare.example/auth",
    token_endpoint: "https://bare.example/token",
    jwks_uri: "https://bare.example/jwks",
  });
  await serveProvider(page, "https://slash.example", discovery("https://slash.example/"));

  await discoverWebId(page, `${alice}#me`);

  await expect(page.getByText("Login may not work with this provider")).toBeVisible();
  await expect(page.getByText(/It doesn't list PKCE with S256/)).toBeVisible();
  await expect(
    page.getByText("The profile and the provider disagree about a trailing slash"),
  ).toBeVisible();
  // A profile's Pod address is shown, but never as a javascript: link.
  await expect(page.getByText("javascript:alert(1)")).toBeVisible();
  await expect(page.getByRole("link", { name: /javascript/ })).toHaveCount(0);
});

test("says when there's no profile at the address", async ({ page }) => {
  await page.route(alice, (route) => route.fulfill({ status: 404, headers: cors, body: "" }));

  await discoverWebId(page, `${alice}#me`);

  await expect(page.getByRole("alert")).toContainText("There's no profile at this address");
  await expect(page.getByRole("alert")).toContainText(`${alice} returned 404 Not Found`);
});

// Playwright's routed responses skip the browser's CORS check, so this test
// uses a real server, on a different origin from the app, that sends no CORS
// headers.
test.describe("a profile server without CORS headers", () => {
  let server: Server;
  let profile: string;

  test.beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/turtle" }).end("<#me> a <#Thing> .");
    });
    await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
    profile = `http://localhost:${(server.address() as AddressInfo).port}/profile`;
  });

  test.afterAll(() => {
    server.close();
  });

  test("is diagnosed as most likely CORS, not as a fact", async ({ page }) => {
    await discoverWebId(page, `${profile}#me`);

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The profile couldn't be fetched");
    await expect(alert).toContainText("The likely cause is CORS");
    await expect(alert).toContainText("this is a diagnosis, not a certainty");
  });
});
