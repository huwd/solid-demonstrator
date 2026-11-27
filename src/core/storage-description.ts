/**
 * Reading a Pod's storage description: the resource each resource in a
 * storage links to, saying what the storage offers. For now that's its
 * notification subscription services, and the kinds of channel each
 * offers, which milestone 5 subscribes through.
 */

import type { PodFetch } from "./pod-fetch.ts";
import { readTurtle, type TurtleProblem } from "./pod-read.ts";
import type { Trace } from "./trace.ts";

const notify = "http://www.w3.org/ns/solid/notifications#";

export interface SubscriptionService {
  readonly url: URL;
  /** Channel types, such as WebSocketChannel2023, by their full IRIs. */
  readonly channelTypes: readonly string[];
  /** Features such as rate or endAt, by their full IRIs. */
  readonly features: readonly string[];
}

export interface StorageDescription {
  readonly url: URL;
  readonly subscriptionServices: readonly SubscriptionService[];
}

export type StorageDescriptionResult =
  | { readonly ok: true; readonly description: StorageDescription }
  | { readonly ok: false; readonly problem: TurtleProblem };

export async function readStorageDescription(
  podFetch: PodFetch,
  url: URL,
  trace: Pick<Trace, "settle">,
): Promise<StorageDescriptionResult> {
  const response = await podFetch({
    describe: {
      step: "readStorageDescription",
      from: "app",
      to: "pod",
      purpose: "Read the storage description, to find what the Pod offers, such as notifications.",
      explanation:
        "Every resource in a Pod links to its storage's description, in a Link header with the relation solid:storageDescription. The description names the Pod's notification subscription services, and the kinds of channel each offers.",
      specification: "https://solidproject.org/TR/protocol#storage-description",
    },
    url,
    headers: { accept: "text/turtle" },
  });
  const read = readTurtle(response, trace, "200 with a Turtle description of the storage");
  if (!read.ok) {
    return read;
  }
  const { quads } = read;
  const objects = (subject: string, predicate: string) =>
    quads
      .filter((quad) => quad.subject.value === subject && quad.predicate.value === predicate)
      .map((quad) => quad.object.value);
  const services = [
    ...new Set(
      quads
        .filter((quad) => quad.predicate.value === `${notify}subscription`)
        .map((quad) => quad.object.value),
    ),
  ]
    .sort()
    .map((service) => ({
      url: new URL(service),
      channelTypes: objects(service, `${notify}channelType`),
      features: objects(service, `${notify}feature`),
    }));
  trace.settle(read.response.entry.id, { kind: "as-expected" });
  return { ok: true, description: { url: read.response.url, subscriptionServices: services } };
}

/** The last part of an IRI, such as WebSocketChannel2023, for display. */
export function localName(iri: string): string {
  return iri.replace(/^.*[#/]/, "") || iri;
}
