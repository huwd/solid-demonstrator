/**
 * The checks a Pod makes of the access token and DPoP proof on every
 * request, repeated by the app (outcome 7, decision 0016).
 *
 * The app builds the request it sends the Pod, with a fresh proof, and
 * checks it as a Pod would with `oauth4webapi`'s `validateJwtAccessToken`:
 * the token's signature against the issuer's published keys, its issuer,
 * audience and lifetime, and that the proof matches the request and the
 * token's key. The WebID check is separate (token-webid-check.ts).
 *
 * `oauth4webapi` follows RFC 9068, which asks more of a token than
 * Solid-OIDC does, and stops at the first rule a token breaks. When that
 * rule is one Solid-OIDC doesn't make, the app says so, rather than that
 * the Pod would refuse, and that the later checks didn't run.
 */

import {
  type AuthorizationServer,
  type Client,
  customFetch,
  DPoP,
  protectedResourceRequest,
  validateJwtAccessToken,
} from "oauth4webapi";
import { discoverIssuer, type IssuerProblem } from "./issuer.ts";
import type { Session } from "./token-exchange.ts";
import type { Trace } from "./trace.ts";
import type { TracedFetch, TracedResponse } from "./traced-fetch.ts";

/** The audience Solid-OIDC access tokens carry for every Pod. */
export const solidAudience = "solid";

/** RFC 9068's rules that Solid-OIDC doesn't make. */
export type BeyondSolidRule = "typ" | "jti" | "sub";

export type PodTrustProblem =
  | { readonly kind: "issuer"; readonly problem: IssuerProblem }
  | { readonly kind: "keys-unavailable"; readonly reason: string }
  | { readonly kind: "beyond-solid"; readonly rule: BeyondSolidRule; readonly message: string }
  | { readonly kind: "refused"; readonly message: string };

export type PodTrustResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: PodTrustProblem };

const step = "checkPodTrust";

// The client is used only for clock skew, which the app doesn't set.
const noClient: Client = { client_id: "" };

const explanation =
  "A Pod checks every request before it answers. It fetches the identity provider's public keys and checks they signed the access token, that the token is from that provider, is for Solid, and hasn't expired. It checks the DPoP proof names this request's method and URL, is fresh, is tied to this token, and was signed with the key the token is bound to. The app built the request it sends the Pod and made the same checks with oauth4webapi.";

export async function checkPodTrust(
  tracedFetch: TracedFetch,
  session: Pick<Session, "issuer" | "accessToken" | "dpopKeyPair">,
  /** A URL in the Pod, for the request to check. */
  target: URL,
  trace: Pick<Trace, "add" | "settle">,
): Promise<PodTrustResult> {
  const result = await check(tracedFetch, session, target, trace);
  trace.add({
    step,
    from: "app",
    to: "app",
    purpose: "Check the access token and a DPoP proof as the Pod will.",
    provenance: "repeated",
    explanation,
    specification: "https://solidproject.org/TR/oidc",
    verdict: result.ok
      ? { kind: "as-expected" }
      : {
          kind: "unexpected",
          expected: "a token and proof a Pod would accept",
          actual: actualFor(result.problem),
        },
  });
  return result;
}

async function check(
  tracedFetch: TracedFetch,
  session: Pick<Session, "issuer" | "accessToken" | "dpopKeyPair">,
  target: URL,
  trace: Pick<Trace, "settle">,
): Promise<PodTrustResult> {
  const discovered = await discoverIssuer(tracedFetch, session.issuer, trace, {
    step,
    purpose:
      "Fetch the identity provider's configuration, to find its public keys, as the Pod will.",
  });
  if (!discovered.ok) {
    return { ok: false, problem: { kind: "issuer", problem: discovered.problem } };
  }
  const { configuration } = discovered;
  const as: AuthorizationServer = {
    issuer: configuration.issuer,
    jwks_uri: configuration.jwksUri.href,
  };

  const request = await buildRequest(session, target);
  const keys: { response: TracedResponse | null } = { response: null };
  try {
    await validateJwtAccessToken(as, request, solidAudience, {
      requireDPoP: true,
      [customFetch]: async (url, init) => {
        const response = await tracedFetch({
          describe: {
            step,
            from: "app",
            to: "identity-provider",
            purpose: "Fetch the identity provider's public keys, to check the token's signature.",
            explanation:
              "The provider publishes the public halves of the keys it signs tokens with, at the jwks_uri its configuration names. A Pod fetches them to check a token's signature.",
            specification: "https://www.rfc-editor.org/rfc/rfc7517#section-5",
          },
          url: new URL(url),
          method: init.method,
          headers: init.headers as Record<string, string>,
        });
        keys.response = response;
        if (!response.ok) {
          throw new TypeError(response.diagnosis.summary);
        }
        trace.settle(
          response.entry.id,
          response.status === 200
            ? { kind: "as-expected" }
            : { kind: "unexpected", expected: "200 with the keys", actual: `${response.status}` },
        );
        return new Response(response.text, { status: response.status, headers: response.headers });
      },
    });
  } catch (error) {
    return { ok: false, problem: classify(error, keys.response) };
  }
  return { ok: true };
}

/**
 * The request the app sends the Pod for `target`, with a fresh DPoP proof.
 * Nothing is sent: the custom fetch keeps the request instead.
 */
async function buildRequest(
  session: Pick<Session, "accessToken" | "dpopKeyPair">,
  target: URL,
): Promise<Request> {
  const built: { request: Request | null } = { request: null };
  await protectedResourceRequest(session.accessToken, "GET", target, new Headers(), null, {
    DPoP: DPoP(noClient, session.dpopKeyPair),
    [customFetch]: async (url, init) => {
      built.request = new Request(url, init as RequestInit);
      return new Response(null, { status: 204 });
    },
  });
  // protectedResourceRequest calls the custom fetch, or throws.
  return built.request as unknown as Request;
}

function classify(error: unknown, keys: TracedResponse | null): PodTrustProblem {
  if (keys !== null && !keys.ok) {
    return { kind: "keys-unavailable", reason: keys.diagnosis.summary };
  }
  if (keys !== null && keys.status !== 200) {
    return { kind: "keys-unavailable", reason: `The provider answered ${keys.status}.` };
  }
  // oauth4webapi throws only Errors, and so does the custom fetch above.
  const { message } = error as Error;
  const rule = beyondSolidRule(message);
  return rule === null ? { kind: "refused", message } : { kind: "beyond-solid", rule, message };
}

/**
 * Which RFC 9068 rule beyond Solid-OIDC an `oauth4webapi` error is about,
 * if any. The tests pin each message, so an upgrade that changes them fails.
 */
export function beyondSolidRule(message: string): BeyondSolidRule | null {
  // The app's own DPoP proofs, made by oauth4webapi, always have the right
  // typ, so a typ error is about the access token.
  if (message === 'unexpected JWT "typ" header parameter value') {
    return "typ";
  }
  const claim =
    /^JWT "(jti|sub)" \(.+\) claim missing$|^unexpected JWT "(jti|sub)" claim type$/.exec(message);
  return claim === null ? null : ((claim[1] ?? claim[2]) as BeyondSolidRule);
}

function actualFor(problem: PodTrustProblem): string {
  switch (problem.kind) {
    case "issuer":
      return `an identity provider whose configuration couldn't be read (${problem.problem.kind})`;
    case "keys-unavailable":
      return `keys that couldn't be fetched: ${problem.reason}`;
    case "beyond-solid":
      return `a token RFC 9068 refuses, though Solid-OIDC doesn't: ${problem.message}`;
    case "refused":
      return `a token or proof a Pod would refuse: ${problem.message}`;
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No description for ${JSON.stringify(unhandled)}`);
    }
  }
}
