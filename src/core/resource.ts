/**
 * Reading one resource in the Pod, such as a note or a Turtle document.
 *
 * The app shows text it can display, and describes anything else by its
 * type and size. It keeps the ETag, the version of the resource the Pod
 * sent, so a later edit can ask the Pod to refuse it if someone else has
 * changed the resource since (milestone 4).
 */

import { type Access, readWacAllow } from "./container.ts";
import type { PodFetch } from "./pod-fetch.ts";
import { type ReadProblem, readStatusProblem } from "./pod-read.ts";
import type { Trace } from "./trace.ts";

export interface Resource {
  readonly url: URL;
  readonly contentType: string | null;
  /** The body, when it's text the app can show; null for anything else. */
  readonly text: string | null;
  /** In bytes, where the Pod says. */
  readonly size: number | null;
  readonly etag: string | null;
  readonly access: Access | null;
}

export type ResourceResult =
  | { readonly ok: true; readonly resource: Resource }
  | { readonly ok: false; readonly problem: ReadProblem };

export async function readResource(
  podFetch: PodFetch,
  url: URL,
  trace: Pick<Trace, "settle">,
): Promise<ResourceResult> {
  const response = await podFetch({
    describe: {
      step: "readResource",
      from: "app",
      to: "pod",
      purpose: "Read a resource in the Pod, as the logged-in person.",
      explanation:
        "As with a container, the request carries the access token and a fresh DPoP proof. The ETag in the response names this version of the resource, which an edit can use to make sure it doesn't overwrite a newer one.",
      specification: "https://solidproject.org/TR/protocol#reading-resources",
    },
    url,
  });
  if (!response.ok) {
    return { ok: false, problem: { kind: "request-failed", diagnosis: response.diagnosis } };
  }
  const failed = readStatusProblem(response.status);
  if (failed !== null) {
    trace.settle(response.entry.id, {
      kind: "unexpected",
      expected: "200 with the resource",
      actual: failed.actual,
    });
    return { ok: false, problem: failed.problem };
  }

  const contentType = response.headers.get("content-type");
  const length = Number(response.headers.get("content-length") ?? Number.NaN);
  trace.settle(response.entry.id, { kind: "as-expected" });
  return {
    ok: true,
    resource: {
      url: response.url,
      contentType,
      text: isText(contentType) ? response.text : null,
      size: Number.isFinite(length) ? length : null,
      etag: response.headers.get("etag"),
      access: readWacAllow(response.headers.get("wac-allow")),
    },
  };
}

/** Text the app can show as it is: plain text, and text-based data formats. */
export function isText(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }
  const type = contentType.replace(/;.*$/, "").trim().toLowerCase();
  return (
    type.startsWith("text/") ||
    /^application\/(json|xml)$/.test(type) ||
    // Structured syntax suffixes, such as ld+json or svg+xml (RFC 6839).
    /\+(json|xml)$/.test(type) ||
    type === "application/n-triples" ||
    type === "application/n-quads" ||
    type === "application/trig"
  );
}
