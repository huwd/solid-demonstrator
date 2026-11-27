/**
 * Changing the Pod: creating, editing and deleting resources (outcome 5).
 *
 * Every write carries a condition, so the Pod refuses one that would undo
 * someone else's change:
 *
 * - creating sends `If-None-Match: *`, so it never replaces something
 *   already at that address
 * - editing sends `If-Match` with the ETag of the version the person saw,
 *   so the Pod refuses it with `412` if the resource has changed since
 * - deleting sends `If-Match` too, when the version is known
 *
 * The scratch folder and the switch for writing elsewhere are the app's own
 * safeguards (decision 0017). The Pod applies only its access rules.
 */

import type { PodFetch } from "./pod-fetch.ts";
import type { Diagnosis, Trace } from "./trace.ts";

export type WriteProblem =
  | { readonly kind: "request-failed"; readonly diagnosis: Diagnosis }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not-found" }
  /** The resource changed since the person read it, so the Pod refused the edit. */
  | { readonly kind: "changed" }
  /** Something is already at the address, so the Pod refused to create it. */
  | { readonly kind: "exists" }
  /** A container still holds something, so the Pod won't delete it. */
  | { readonly kind: "not-empty" }
  | { readonly kind: "http-error"; readonly status: number };

export type WriteResult =
  | {
      readonly ok: true;
      readonly url: URL;
      /** The new version's ETag, where the Pod sends one. */
      readonly etag: string | null;
    }
  | { readonly ok: false; readonly problem: WriteProblem };

export interface Content {
  readonly contentType: string;
  readonly body: string;
}

/** The scratch folder the app writes in by default (decision 0017). */
export function scratchFolder(storage: URL): URL {
  return new URL("solid-demonstrator/", storage);
}

/** Whether a resource is the folder itself, or anywhere inside it. */
export function isInside(url: URL, folder: URL): boolean {
  return url.href.startsWith(folder.href);
}

/** Creates a resource, or a container if the URL ends in a slash, without replacing anything. */
export function createResource(
  podFetch: PodFetch,
  url: URL,
  content: Content,
  trace: Pick<Trace, "settle">,
  options: {
    readonly purpose?: string;
    /** Whether something already there is what the step expects. */
    readonly existingIsFine?: boolean;
  } = {},
): Promise<WriteResult> {
  return write(podFetch, trace, {
    step: "createResource",
    purpose:
      options.purpose ??
      (url.pathname.endsWith("/")
        ? "Create a folder in the Pod."
        : "Create a resource in the Pod."),
    existingIsFine: options.existingIsFine ?? false,
    explanation:
      "A PUT to a new address creates the resource there. If-None-Match: * asks the Pod to refuse, with 412, if anything is already at that address, so creating never replaces anyone's data.",
    url,
    method: "PUT",
    headers: { "content-type": content.contentType, "if-none-match": "*" },
    body: content.body,
    expected: "201, created",
    conditionFailed: "exists",
  });
}

/** Replaces a resource's content, if it's still the version the person read. */
export function updateResource(
  podFetch: PodFetch,
  url: URL,
  etag: string,
  content: Content,
  trace: Pick<Trace, "settle">,
): Promise<WriteResult> {
  return write(podFetch, trace, {
    step: "updateResource",
    purpose: "Save a change to a resource, unless someone else has changed it first.",
    explanation: `If-Match names the version the app read, ${etag}. If anyone has changed the resource since, its ETag no longer matches, and the Pod refuses the write with 412 rather than overwrite their change.`,
    url,
    method: "PUT",
    headers: { "content-type": content.contentType, "if-match": etag },
    body: content.body,
    expected: "a 2xx status, saved",
    conditionFailed: "changed",
  });
}

/** Deletes a resource, or an empty container, checking its version where known. */
export function deleteResource(
  podFetch: PodFetch,
  url: URL,
  etag: string | null,
  trace: Pick<Trace, "settle">,
): Promise<WriteResult> {
  return write(podFetch, trace, {
    step: "deleteResource",
    purpose: "Delete a resource from the Pod.",
    explanation:
      etag === null
        ? "The Pod sent no version for this resource, so the delete can't check it hasn't changed. A Pod refuses to delete a folder that still holds something."
        : `If-Match names the version the app read, ${etag}, so the Pod refuses the delete if the resource has changed since. A Pod refuses to delete a folder that still holds something.`,
    url,
    method: "DELETE",
    headers: etag === null ? {} : { "if-match": etag },
    expected: "a 2xx status, deleted",
    conditionFailed: "changed",
  });
}

async function write(
  podFetch: PodFetch,
  trace: Pick<Trace, "settle">,
  request: {
    readonly step: string;
    readonly purpose: string;
    readonly explanation: string;
    readonly url: URL;
    readonly method: "PUT" | "DELETE";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly expected: string;
    readonly conditionFailed: "exists" | "changed";
    readonly existingIsFine?: boolean;
  },
): Promise<WriteResult> {
  const response = await podFetch({
    describe: {
      step: request.step,
      from: "app",
      to: "pod",
      purpose: request.purpose,
      explanation: request.explanation,
      specification: "https://solidproject.org/TR/protocol#writing-resources",
    },
    url: request.url,
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
  });
  if (!response.ok) {
    return { ok: false, problem: { kind: "request-failed", diagnosis: response.diagnosis } };
  }
  const refused = writeStatusProblem(response.status, request.conditionFailed);
  if (refused !== null) {
    trace.settle(
      response.entry.id,
      request.existingIsFine === true && refused.problem.kind === "exists"
        ? { kind: "as-expected" }
        : { kind: "unexpected", expected: request.expected, actual: refused.actual },
    );
    return { ok: false, problem: refused.problem };
  }
  trace.settle(response.entry.id, { kind: "as-expected" });
  return { ok: true, url: request.url, etag: response.headers.get("etag") };
}

function writeStatusProblem(
  status: number,
  conditionFailed: "exists" | "changed",
): { readonly problem: WriteProblem; readonly actual: string } | null {
  switch (status) {
    case 401:
      return {
        problem: { kind: "unauthenticated" },
        actual: "401: the Pod didn't accept the token",
      };
    case 403:
      return { problem: { kind: "forbidden" }, actual: "403: this person may not change it" };
    case 404:
      return { problem: { kind: "not-found" }, actual: "404: there's nothing here" };
    case 409:
      return { problem: { kind: "not-empty" }, actual: "409: the folder isn't empty" };
    case 412:
      return conditionFailed === "exists"
        ? { problem: { kind: "exists" }, actual: "412: something is already there" }
        : { problem: { kind: "changed" }, actual: "412: it has changed since the app read it" };
  }
  return status >= 200 && status <= 299
    ? null
    : { problem: { kind: "http-error", status }, actual: `${status}` };
}

/**
 * Makes sure the scratch folder exists: creates it, or finds it's already
 * there. Either way the app can write in it.
 */
export async function ensureScratchFolder(
  podFetch: PodFetch,
  storage: URL,
  trace: Pick<Trace, "settle">,
): Promise<
  | { readonly ok: true; readonly url: URL; readonly created: boolean }
  | { readonly ok: false; readonly problem: WriteProblem }
> {
  const url = scratchFolder(storage);
  const result = await createResource(
    podFetch,
    url,
    { contentType: "text/turtle", body: "" },
    trace,
    {
      purpose: "Create the app's scratch folder, unless it's already there.",
      existingIsFine: true,
    },
  );
  if (result.ok) {
    return { ok: true, url, created: true };
  }
  return result.problem.kind === "exists" ? { ok: true, url, created: false } : result;
}
