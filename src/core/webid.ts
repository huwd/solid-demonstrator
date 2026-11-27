/**
 * Reading the WebID a person typed, before anything is fetched.
 *
 * A WebID names a person, and the document that describes them is the same
 * URL without its fragment: `https://example.org/profile#me` is described by
 * `https://example.org/profile`. Browsers never send the fragment, so the
 * demonstrator fetches the document and looks for the full WebID inside it.
 */

export type WebIdInput =
  | {
      readonly ok: true;
      /** The WebID itself, which identifies the person. */
      readonly webId: URL;
      /** The URL that is fetched: the WebID without its fragment. */
      readonly profileDocument: URL;
    }
  | {
      readonly ok: false;
      readonly problem: WebIdProblem;
    };

export type WebIdProblem = "empty" | "not-a-url" | "not-https" | "has-credentials";

/**
 * Checks what a person typed is a WebID the demonstrator can fetch.
 *
 * The WebID specification requires HTTPS. HTTP is accepted only on a
 * loopback host, so a local test stack can be explored.
 */
export function readWebId(typed: string): WebIdInput {
  const trimmed = typed.trim();
  if (trimmed === "") {
    return { ok: false, problem: "empty" };
  }
  const webId = URL.parse(trimmed);
  if (webId === null) {
    return { ok: false, problem: "not-a-url" };
  }
  if (webId.username !== "" || webId.password !== "") {
    return { ok: false, problem: "has-credentials" };
  }
  if (!isAllowedScheme(webId)) {
    return { ok: false, problem: "not-https" };
  }
  const profileDocument = new URL(webId);
  profileDocument.hash = "";
  return { ok: true, webId, profileDocument };
}

const loopbackHosts: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether the demonstrator may fetch a URL: HTTPS, or HTTP on a loopback
 * host for a local test stack.
 */
export function isAllowedScheme(url: URL): boolean {
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && loopbackHosts.has(url.hostname);
}
