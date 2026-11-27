/**
 * The check a Pod makes on every request: fetch the WebID the token names,
 * and check its profile names the token's issuer. Without it, anyone
 * running an identity provider could issue tokens naming any WebID.
 *
 * The app repeats the check after login, so the person sees its result
 * before the Pod makes it (outcome 3, decision 0004).
 */

import { fetchWebIdProfile, type ProfileProblem } from "./profile.ts";
import type { Trace } from "./trace.ts";
import type { TracedFetch } from "./traced-fetch.ts";
import { readWebId, type WebIdProblem } from "./webid.ts";

export type WebIdCheckProblem =
  | { readonly kind: "no-webid" }
  | { readonly kind: "bad-webid"; readonly problem: WebIdProblem }
  | { readonly kind: "profile"; readonly document: URL; readonly problem: ProfileProblem }
  | { readonly kind: "issuer-not-named"; readonly named: readonly string[] };

export type WebIdCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: WebIdCheckProblem };

const explanation =
  "A Pod makes this check on every request: it fetches the WebID named in the token, and checks the profile names the token's issuer as one of the person's identity providers. Otherwise any identity provider could issue tokens naming any WebID. The app repeats the check here, to show its result before the Pod makes it.";

export async function checkTokenWebId(
  tracedFetch: TracedFetch,
  token: { readonly issuer: string; readonly webId: string | null },
  trace: Pick<Trace, "add" | "settle">,
): Promise<WebIdCheckResult> {
  const result = await check(tracedFetch, token, trace);
  trace.add({
    step: "checkTokenWebId",
    from: "app",
    to: "app",
    purpose: "Check the WebID's profile names the token's issuer, as the Pod will.",
    provenance: "repeated",
    explanation,
    specification: "https://solidproject.org/TR/oidc",
    verdict: result.ok
      ? { kind: "as-expected" }
      : {
          kind: "unexpected",
          expected: `a profile naming ${token.issuer} as an identity provider`,
          actual: actualFor(result.problem),
        },
  });
  return result;
}

async function check(
  tracedFetch: TracedFetch,
  token: { readonly issuer: string; readonly webId: string | null },
  trace: Pick<Trace, "settle">,
): Promise<WebIdCheckResult> {
  if (token.webId === null) {
    return { ok: false, problem: { kind: "no-webid" } };
  }
  const input = readWebId(token.webId);
  if (!input.ok) {
    return { ok: false, problem: { kind: "bad-webid", problem: input.problem } };
  }
  const profile = await fetchWebIdProfile(tracedFetch, input, trace, {
    step: "checkTokenWebId",
    purpose: "Fetch the WebID profile named in the token, to check it names the token's issuer.",
  });
  if (!profile.ok) {
    return {
      ok: false,
      problem: { kind: "profile", document: input.profileDocument, problem: profile.problem },
    };
  }
  const named = profile.profile.issuers;
  return named.includes(token.issuer)
    ? { ok: true }
    : { ok: false, problem: { kind: "issuer-not-named", named } };
}

function actualFor(problem: WebIdCheckProblem): string {
  switch (problem.kind) {
    case "no-webid":
      return "a token that names no WebID";
    case "bad-webid":
      return `a WebID the app can't fetch (${problem.problem})`;
    case "profile":
      return `a profile the app couldn't read (${problem.problem.kind})`;
    case "issuer-not-named":
      return problem.named.length === 0
        ? "a profile that names no identity provider"
        : `a profile naming ${problem.named.join(", ")}`;
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No description for ${JSON.stringify(unhandled)}`);
    }
  }
}
