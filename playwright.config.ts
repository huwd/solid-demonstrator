import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// devenv provides the browsers from nixpkgs, which only work with the
// matching Playwright release. Fail clearly rather than with a missing
// browser build.
const nixVersion = process.env["PLAYWRIGHT_NIX_VERSION"];
const installed = (
  JSON.parse(
    readFileSync(new URL("node_modules/@playwright/test/package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;
if (nixVersion !== undefined && nixVersion !== installed) {
  throw new Error(
    `@playwright/test is ${installed}, but devenv's browsers are for ${nixVersion}. Pin @playwright/test to ${nixVersion} in package.json.`,
  );
}

// Browser tests of src/app, in the three engines decision 0012 names. They
// run against the built app, served by `vite preview`, so they test what is
// deployed rather than the development server.
const port = 4173;

export default defineConfig({
  testDir: "src/app",
  testMatch: "**/*.spec.ts",
  forbidOnly: process.env["CI"] !== undefined,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `vite build && vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
