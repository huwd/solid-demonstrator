/**
 * Reading a container in the Pod: the storage root, or any folder inside it.
 *
 * A Solid container is an LDP Basic Container. Fetched as Turtle, it lists
 * what it contains with `ldp:contains`, and says which of those are
 * containers themselves. The `WAC-Allow` header says what the logged-in
 * person may do with it, which the app shows beside the listing.
 */

import type { Quad } from "n3";
import { readSolidLinks, type SolidLinks } from "./link-header.ts";
import type { PodFetch } from "./pod-fetch.ts";
import { readTurtle, type TurtleProblem } from "./pod-read.ts";
import type { Trace } from "./trace.ts";

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
  readonly links: SolidLinks;
}

export type ContainerProblem = TurtleProblem | { readonly kind: "not-a-container" };

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
  const read = readTurtle(response, trace, "200 with a Turtle listing of the container");
  if (!read.ok) {
    return read;
  }
  const { quads } = read;
  const here = read.response.url.href;
  const types = (subject: string) =>
    quads
      .filter((quad) => quad.subject.value === subject && quad.predicate.value === rdfType)
      .map((quad) => quad.object.value);
  if (!types(here).some((type) => type === `${ldp}Container` || type === `${ldp}BasicContainer`)) {
    trace.settle(read.response.entry.id, {
      kind: "unexpected",
      expected: "an LDP container",
      actual: "a resource that isn't a container",
    });
    return { ok: false, problem: { kind: "not-a-container" } };
  }

  const contains = quads
    .filter((quad) => quad.subject.value === here && quad.predicate.value === `${ldp}contains`)
    .map((quad) => describeContained(quad.object.value, quads, types))
    .sort((a, b) => a.url.href.localeCompare(b.url.href));
  trace.settle(read.response.entry.id, { kind: "as-expected" });
  const { url: listed, headers } = read.response;
  return {
    ok: true,
    container: {
      url: listed,
      contains,
      access: readWacAllow(headers.get("wac-allow")),
      links: readSolidLinks(headers.get("link"), listed),
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
