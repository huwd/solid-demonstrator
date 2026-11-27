/**
 * What a Pod's answer to a read means, before its body is looked at: the
 * same for a container as for any other resource.
 */

import type { Diagnosis } from "./trace.ts";

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
