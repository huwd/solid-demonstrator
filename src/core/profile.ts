/**
 * Discovery, step 1: reading the WebID profile.
 *
 * The profile is where trust in Solid starts. It names the identity
 * providers that may log the person in (`solid:oidcIssuer`) and the Pods
 * where their data lives (`pim:storage`). See
 * docs/decisions/0001-start-from-the-webid.md.
 */

import { Parser, type Quad } from "n3";
import type { Diagnosis, Trace } from "./trace.ts";
import type { TracedFetch } from "./traced-fetch.ts";
import type { WebIdInput } from "./webid.ts";

export interface WebIdProfile {
  readonly webId: URL;
  /** The document the profile was read from, after any redirects. */
  readonly document: URL;
  readonly issuers: readonly URL[];
  readonly storages: readonly URL[];
  readonly name: string | null;
}

export type ProfileProblem =
  | { readonly kind: "request-failed"; readonly diagnosis: Diagnosis }
  | { readonly kind: "http-error"; readonly status: number }
  | { readonly kind: "not-turtle"; readonly contentType: string | null }
  | { readonly kind: "too-large"; readonly length: number }
  | { readonly kind: "unparseable"; readonly message: string }
  | { readonly kind: "webid-not-described" };

export type ProfileResult =
  | { readonly ok: true; readonly profile: WebIdProfile }
  | { readonly ok: false; readonly problem: ProfileProblem };

const vocabulary = {
  oidcIssuer: "http://www.w3.org/ns/solid/terms#oidcIssuer",
  storage: "http://www.w3.org/ns/pim/space#storage",
  name: "http://xmlns.com/foaf/0.1/name",
} as const;

/** Profiles are small documents; anything this size is not one. */
const profileLengthMax = 1_000_000;

export async function fetchWebIdProfile(
  tracedFetch: TracedFetch,
  input: Pick<Extract<WebIdInput, { ok: true }>, "webId" | "profileDocument">,
  trace: Pick<Trace, "settle">,
): Promise<ProfileResult> {
  const response = await tracedFetch({
    describe: {
      step: "fetchWebIdProfile",
      from: "app",
      to: "webid-profile",
      purpose:
        "Fetch the WebID profile, asking for Turtle, to find which identity providers and Pods it names.",
      explanation: `The WebID is ${input.webId.href}. Browsers never send the part after #, so the app fetches ${input.profileDocument.href} and looks for the full WebID inside it.`,
      specification:
        "https://www.w3.org/2005/Incubator/webid/spec/identity/#processing-the-webid-profile",
    },
    url: input.profileDocument,
    headers: { accept: "text/turtle" },
  });
  if (!response.ok) {
    return { ok: false, problem: { kind: "request-failed", diagnosis: response.diagnosis } };
  }

  const refuse = (problem: ProfileProblem, expected: string, actual: string): ProfileResult => {
    trace.settle(response.entry.id, { kind: "unexpected", expected, actual });
    return { ok: false, problem };
  };

  if (response.status !== 200) {
    return refuse(
      { kind: "http-error", status: response.status },
      "200 OK",
      `${response.status}: the profile isn't available at this address`,
    );
  }
  const contentType = response.headers.get("content-type");
  if (contentType === null || !/^text\/turtle\b/i.test(contentType)) {
    return refuse(
      { kind: "not-turtle", contentType },
      "a Turtle document (text/turtle), which every WebID profile must offer",
      contentType === null ? "no content type" : contentType,
    );
  }
  if (response.text.length > profileLengthMax) {
    return refuse(
      { kind: "too-large", length: response.text.length },
      `a profile of at most ${profileLengthMax} characters`,
      `${response.text.length} characters`,
    );
  }

  let quads: Quad[];
  try {
    quads = new Parser({ baseIRI: response.url.href, format: "text/turtle" }).parse(response.text);
  } catch (error) {
    // n3 reports a syntax error with its line number, which is worth showing.
    const message = String(error).replace(/^Error: /, "");
    return refuse(
      { kind: "unparseable", message },
      "valid Turtle",
      `Turtle that can't be read: ${message}`,
    );
  }

  const aboutWebId = quads.filter((quad) => quad.subject.value === input.webId.href);
  if (aboutWebId.length === 0) {
    return refuse(
      { kind: "webid-not-described" },
      `statements about ${input.webId.href}`,
      "a document that says nothing about this WebID",
    );
  }

  trace.settle(response.entry.id, { kind: "as-expected" });
  return {
    ok: true,
    profile: {
      webId: input.webId,
      document: response.url,
      issuers: namedObjects(aboutWebId, vocabulary.oidcIssuer),
      storages: namedObjects(aboutWebId, vocabulary.storage),
      name: aboutWebId.find((quad) => isLiteralOf(quad, vocabulary.name))?.object.value ?? null,
    },
  };
}

/** The distinct IRIs a predicate points to. Literals and blank nodes are skipped. */
function namedObjects(quads: readonly Quad[], predicate: string): URL[] {
  const iris = new Set(
    quads
      .filter((quad) => quad.predicate.value === predicate && quad.object.termType === "NamedNode")
      .map((quad) => quad.object.value),
  );
  return [...iris].map((iri) => new URL(iri));
}

function isLiteralOf(quad: Quad, predicate: string): boolean {
  return quad.predicate.value === predicate && quad.object.termType === "Literal";
}
