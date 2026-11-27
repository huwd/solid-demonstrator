import { defineConfig } from "vite";
import { basePath } from "./src/core/site-url.ts";

// A deployment sets SITE_URL to where it's served, such as
// https://example.org/demonstrator/, and the app's files are served under
// that path. Unset, as in local development and tests, it's served from /.
// See docs/decisions/0013-deploy-to-github-pages.md.
export default defineConfig({
  base: basePath(process.env["SITE_URL"]),
});
