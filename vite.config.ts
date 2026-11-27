import { defineConfig, type Plugin } from "vite";
import { clientIdDocument, clientIdDocumentPath } from "./src/core/client-id.ts";
import { basePath, readSiteUrl } from "./src/core/site-url.ts";

// A deployment sets SITE_URL to where it's served, such as
// https://example.org/demonstrator/, and the app's files are served under
// that path. Unset, as in local development and tests, it's served from /.
// See docs/decisions/0013-deploy-to-github-pages.md.
const siteUrlSetting = process.env["SITE_URL"];

/**
 * Publishes the Client ID Document beside the app. It names the app's own
 * address, so it exists only when SITE_URL says what that is.
 */
function clientIdDocumentPlugin(): Plugin {
  const siteUrl = readSiteUrl(siteUrlSetting);
  const body = siteUrl === null ? null : `${JSON.stringify(clientIdDocument(siteUrl), null, 2)}\n`;
  return {
    name: "client-id-document",
    generateBundle() {
      if (body !== null) {
        this.emitFile({ type: "asset", fileName: clientIdDocumentPath, source: body });
      }
    },
    configureServer(server) {
      if (body === null) {
        return;
      }
      const path = `${basePath(siteUrlSetting)}${clientIdDocumentPath}`;
      server.middlewares.use(path, (_request, response) => {
        response.setHeader("content-type", "application/ld+json");
        response.end(body);
      });
    },
  };
}

export default defineConfig({
  base: basePath(siteUrlSetting),
  plugins: [clientIdDocumentPlugin()],
});
