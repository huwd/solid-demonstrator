/**
 * Where a deployment is served from, set by the `SITE_URL` build setting,
 * such as `https://example.org/demonstrator/`. Nothing in the code names a
 * real address (decision 0003); a deployment sets this instead.
 */

import { isAllowedScheme } from "./webid.ts";

/**
 * Reads `SITE_URL`. Returns null when it isn't set, as in local
 * development, and throws on a value no deployment could use, so a bad
 * setting fails the build rather than the deployed app.
 */
export function readSiteUrl(value: string | undefined): URL | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const url = URL.parse(value.trim());
  if (url === null || !isAllowedScheme(url)) {
    throw new Error(`SITE_URL must be an https:// address, or http:// on localhost: ${value}`);
  }
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    throw new Error(`SITE_URL must have no credentials, query or fragment: ${value}`);
  }
  if (!url.pathname.endsWith("/")) {
    throw new Error(`SITE_URL must end with /, as the app is served from a directory: ${value}`);
  }
  return url;
}

/** The path the app's files are served under: `/` unless `SITE_URL` says otherwise. */
export function basePath(value: string | undefined): string {
  return readSiteUrl(value)?.pathname ?? "/";
}
