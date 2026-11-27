/**
 * Reading a container in the Pod: the storage root, or any folder inside it.
 *
 * A Solid container is an LDP Basic Container. Fetched as Turtle, it lists
 * what it contains with `ldp:contains`, and says which of those are
 * containers themselves. The `WAC-Allow` header says what the logged-in
 * person may do with it, which the app shows beside the listing.
 */

import { Parser, type Quad } from "n3";
import type { PodFetch } from "./pod-fetch.ts";
import type { Diagnosis, Trace } from "./trace.ts";

const ldp = "http://www.w3.org/ns/ldp#";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const modified = "http://purl.org/dc/terms/modified";
const size = "http://www.w3.org/ns/posix/stat#size";

export interface ContainedResource {
  readonly url: URL;
  readonly isContainer: boolean;
  readonly modified: Date | null;
  /** In bytes, where the Pod says. */
  readonly size: number | null;
}

/** What the WAC-Allow header grants: to this person, and to everyone. */
export interface Access {
  readonly user: readonly string[];
  readonly public: readonly string[];
}

export interface Container {
  readonly url: URL;
  readonly contains: readonly ContainedResource[];
  /** Null if the Pod didn't send WAC-Allow. */
  readonly access: Access | null;
}

export type ContainerProblem =
  | { readonly kind: "request-failed"; readonly diagnosis: Diagnosis }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not-found" }
  | { readonly kind: "http-error"; readonly status: number }
  | { readonly kind: "not-turtle"; readonly contentType: string | null }
  | { readonly kind: "unparseable"; readonly message: string }
  | { readonly kind: "not-a-container" };

export type ContainerResult =
  | { readonly ok: true; readonly container: Container }
  | { readonly ok: false; readonly problem: ContainerProblem };

export async function readContainer(
  podFetch: PodFetch,
  url: URL,
  trace: Pick<Trace, "settle">,
): Promise<ContainerResult> {
  const response = await podFetch({
    describe: {
      step: "readContainer",
      from: "app",
      to: "pod",
      purpose: "Read a container in the Pod, as the logged-in person, to list what it holds.",
      explanation:
        "The access token goes in the Authorization header, and the DPoP header is a fresh proof for this request alone, naming its method and URL. The Pod checks both before it answers. The WAC-Allow header in the response says what this person may do here.",
      specification: "https://solidproject.org/TR/protocol#reading-resources",
    },
    url,
    headers: { accept: "text/turtle" },
  });
  if (!response.ok) {
    return { ok: false, problem: { kind: "request-failed", diagnosis: response.diagnosis } };
  }
  const refuse = (problem: ContainerProblem, expected: string, actual: string): ContainerResult => {
    trace.settle(response.entry.id, { kind: "unexpected", expected, actual });
    return { ok: false, problem };
  };
  const listing = "200 with a Turtle listing of the container";

  switch (response.status) {
    case 401:
      return refuse({ kind: "unauthenticated" }, listing, "401: the Pod didn't accept the token");
    case 403:
      return refuse({ kind: "forbidden" }, listing, "403: this person may not read it");
    case 404:
      return refuse({ kind: "not-found" }, listing, "404: there's nothing here");
  }
  if (response.status < 200 || response.status > 299) {
    return refuse({ kind: "http-error", status: response.status }, listing, `${response.status}`);
  }
  const contentType = response.headers.get("content-type");
  if (contentType === null || !/^text\/turtle\b/i.test(contentType)) {
    return refuse(
      { kind: "not-turtle", contentType },
      listing,
      `content type ${contentType ?? "none"}`,
    );
  }

  let quads: Quad[];
  try {
    quads = new Parser({ baseIRI: response.url.href, format: "text/turtle" }).parse(response.text);
  } catch (error) {
    const message = String(error).replace(/^Error: /, "");
    return refuse(
      { kind: "unparseable", message },
      "valid Turtle",
      `Turtle that can't be read: ${message}`,
    );
  }

  const here = response.url.href;
  const types = (subject: string) =>
    quads
      .filter((quad) => quad.subject.value === subject && quad.predicate.value === rdfType)
      .map((quad) => quad.object.value);
  if (!types(here).some((type) => type === `${ldp}Container` || type === `${ldp}BasicContainer`)) {
    return refuse(
      { kind: "not-a-container" },
      "an LDP container",
      "a resource that isn't a container",
    );
  }

  const contains = quads
    .filter((quad) => quad.subject.value === here && quad.predicate.value === `${ldp}contains`)
    .map((quad) => describeContained(quad.object.value, quads, types))
    .sort((a, b) => a.url.href.localeCompare(b.url.href));
  trace.settle(response.entry.id, { kind: "as-expected" });
  return {
    ok: true,
    container: {
      url: response.url,
      contains,
      access: readWacAllow(response.headers.get("wac-allow")),
    },
  };
}

function describeContained(
  href: string,
  quads: readonly Quad[],
  types: (subject: string) => readonly string[],
): ContainedResource {
  const value = (predicate: string) =>
    quads.find((quad) => quad.subject.value === href && quad.predicate.value === predicate)?.object
      .value;
  const when = value(modified);
  const bytes = Number(value(size));
  return {
    url: new URL(href),
    // A container's URL ends in a slash (Solid Protocol, section 3.1).
    isContainer: href.endsWith("/") || types(href).includes(`${ldp}Container`),
    modified: when === undefined || Number.isNaN(Date.parse(when)) ? null : new Date(when),
    size: Number.isFinite(bytes) ? bytes : null,
  };
}

/**
 * Reads a WAC-Allow header, such as `user="read write", public="read"`.
 * Unknown groups are ignored.
 */
export function readWacAllow(header: string | null): Access | null {
  if (header === null) {
    return null;
  }
  const groups: Record<string, string[]> = {};
  for (const [, group = "", modes = ""] of header.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
    groups[group.toLowerCase()] = modes.split(/\s+/).filter((mode) => mode !== "");
  }
  return { user: groups["user"] ?? [], public: groups["public"] ?? [] };
}
