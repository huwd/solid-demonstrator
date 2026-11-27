/**
 * What a Pod's answer to a read means, before its body is looked at: the
 * same for a container as for any other resource.
 */

import { Parser, type Quad } from "n3";
import type { Diagnosis, Trace } from "./trace.ts";
import type { TracedResponse } from "./traced-fetch.ts";

export type ReadProblem =
  | { readonly kind: "request-failed"; readonly diagnosis: Diagnosis }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not-found" }
  | { readonly kind: "http-error"; readonly status: number };

/** Why a status means the read failed, with what to record; null for a success. */
export function readStatusProblem(
  status: number,
): { readonly problem: ReadProblem; readonly actual: string } | null {
  switch (status) {
    case 401:
      return {
        problem: { kind: "unauthenticated" },
        actual: "401: the Pod didn't accept the token",
      };
    case 403:
      return { problem: { kind: "forbidden" }, actual: "403: this person may not read it" };
    case 404:
      return { problem: { kind: "not-found" }, actual: "404: there's nothing here" };
  }
  return status >= 200 && status <= 299
    ? null
    : { problem: { kind: "http-error", status }, actual: `${status}` };
}

export type TurtleProblem =
  | ReadProblem
  | { readonly kind: "not-turtle"; readonly contentType: string | null }
  | { readonly kind: "unparseable"; readonly message: string };

/**
 * A Pod's answer read as Turtle, or why it can't be. A failure settles the
 * entry as unexpected; a success is left for the step to settle, since
 * only it knows whether the Turtle says what it should.
 */
export function readTurtle(
  response: TracedResponse,
  trace: Pick<Trace, "settle">,
  expected: string,
):
  | { readonly ok: true; readonly response: TracedResponse & { ok: true }; readonly quads: Quad[] }
  | { readonly ok: false; readonly problem: TurtleProblem } {
  if (!response.ok) {
    return { ok: false, problem: { kind: "request-failed", diagnosis: response.diagnosis } };
  }
  const refuse = (problem: TurtleProblem, wanted: string, actual: string) => {
    trace.settle(response.entry.id, { kind: "unexpected", expected: wanted, actual });
    return { ok: false, problem } as const;
  };
  const failed = readStatusProblem(response.status);
  if (failed !== null) {
    return refuse(failed.problem, expected, failed.actual);
  }
  const contentType = response.headers.get("content-type");
  if (contentType === null || !/^text\/turtle\b/i.test(contentType)) {
    return refuse(
      { kind: "not-turtle", contentType },
      expected,
      `content type ${contentType ?? "none"}`,
    );
  }
  try {
    const quads = new Parser({ baseIRI: response.url.href, format: "text/turtle" }).parse(
      response.text,
    );
    return { ok: true, response, quads };
  } catch (error) {
    const message = String(error).replace(/^Error: /, "");
    return refuse(
      { kind: "unparseable", message },
      "valid Turtle",
      `Turtle that can't be read: ${message}`,
    );
  }
}
