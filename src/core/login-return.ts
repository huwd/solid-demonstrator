/**
 * Login, step 2: the person comes back from their identity provider.
 *
 * The browser left the app for the provider's own pages, so the app saw
 * neither the login nor the consent. It records the trip as three entries:
 * the redirect out and the redirect back, reconstructed from the addresses
 * involved, and the part between, explained (decision 0004).
 *
 * It then checks the response is the one it asked for, before anything is
 * exchanged: `state` must match, `iss` must name the chosen provider, and
 * there must be a code.
 */

import { type AuthorizationServer, type Client, validateAuthResponse } from "oauth4webapi";
import type { PendingLogin } from "./login.ts";
import { redactRequest } from "./redaction.ts";
import type { Trace, Verdict } from "./trace.ts";

export type ReturnProblem =
  | { readonly kind: "state-mismatch" }
  | { readonly kind: "iss-missing" }
  | { readonly kind: "iss-mismatch"; readonly stated: string }
  | { readonly kind: "refused"; readonly error: string; readonly description: string | null }
  | { readonly kind: "no-code" }
  | { readonly kind: "rejected"; readonly message: string };

export type ReturnResult =
  | {
      readonly ok: true;
      /** The response, as validated by oauth4webapi, ready for the code exchange. */
      readonly parameters: URLSearchParams;
    }
  | { readonly ok: false; readonly problem: ReturnProblem };

/** Whether the page was loaded by an identity provider sending the person back. */
export function isLoginReturn(url: URL): boolean {
  const parameters = url.searchParams;
  return parameters.has("state") && (parameters.has("code") || parameters.has("error"));
}

const authorizationSpecification = "https://solidproject.org/TR/oidc#authorization-code-pkce-flow";

export function returnFromLogin(
  pending: PendingLogin,
  returnUrl: URL,
  trace: Pick<Trace, "add">,
): ReturnResult {
  const out = redactRequest({
    method: "GET",
    url: pending.authorizationUrl,
    headers: [],
    body: { kind: "none" },
  });
  trace.add({
    step: "redirectToIdentityProvider",
    from: "app",
    to: "identity-provider",
    purpose:
      "Send the browser to the identity provider's login page, with the PKCE challenge, state and nonce.",
    provenance: "reconstructed",
    request: out.value,
    decodedTokens: out.decodedTokens,
    explanation:
      "Reconstructed from the address the app built. The browser went there and left the app, so the app saw the request but not the page that came back.",
    specification: authorizationSpecification,
    verdict: { kind: "as-expected" },
  });
  trace.add({
    step: "loginAtIdentityProvider",
    from: "identity-provider",
    to: "identity-provider",
    purpose: "The person logs in and decides whether to let the app act for them.",
    provenance: "explained",
    explanation: `This happens on ${pending.issuer}'s own pages, out of the app's sight. The provider checks who the person is, in whatever way it chooses, then shows what the app is asking for and asks the person to agree. If they do, it sends them back with a one-time code.`,
    specification: "https://openid.net/specs/openid-connect-core-1_0.html#Consent",
    verdict: { kind: "as-expected" },
  });

  const result = check(pending, returnUrl);
  const back = redactRequest({
    method: "GET",
    url: returnUrl.href,
    headers: [],
    body: { kind: "none" },
  });
  trace.add({
    step: "returnFromIdentityProvider",
    from: "identity-provider",
    to: "app",
    purpose:
      "The identity provider sends the browser back to the app, with a one-time code, the state and its own name.",
    provenance: "reconstructed",
    request: back.value,
    decodedTokens: back.decodedTokens,
    explanation:
      "Reconstructed from the address the browser came back to. The app checks the state is the one it sent, and the issuer is the provider it chose, before using the code.",
    specification: "https://www.rfc-editor.org/rfc/rfc9207.html",
    verdict: result.ok ? { kind: "as-expected" } : verdictFor(result.problem, pending),
  });
  return result;
}

function check(pending: PendingLogin, returnUrl: URL): ReturnResult {
  const parameters = returnUrl.searchParams;
  if (parameters.get("state") !== pending.state) {
    return { ok: false, problem: { kind: "state-mismatch" } };
  }
  const iss = parameters.get("iss");
  if (iss === null && pending.issParameterSupported) {
    return { ok: false, problem: { kind: "iss-missing" } };
  }
  if (iss !== null && iss !== pending.issuer) {
    return { ok: false, problem: { kind: "iss-mismatch", stated: iss } };
  }
  const error = parameters.get("error");
  if (error !== null) {
    return {
      ok: false,
      problem: { kind: "refused", error, description: parameters.get("error_description") },
    };
  }
  if (!parameters.has("code")) {
    return { ok: false, problem: { kind: "no-code" } };
  }

  // oauth4webapi checks again, more strictly, and its result is what the
  // code exchange accepts (decision 0014).
  const server: AuthorizationServer = {
    issuer: pending.issuer,
    authorization_response_iss_parameter_supported: pending.issParameterSupported,
  };
  const client: Client = { client_id: pending.clientId };
  try {
    return { ok: true, parameters: validateAuthResponse(server, client, returnUrl, pending.state) };
  } catch (error) {
    const message = String(error).replace(/^\w*Error: /, "");
    return { ok: false, problem: { kind: "rejected", message } };
  }
}

function verdictFor(problem: ReturnProblem, pending: PendingLogin): Verdict {
  const unexpected = (expected: string, actual: string): Verdict => ({
    kind: "unexpected",
    expected,
    actual,
  });
  switch (problem.kind) {
    case "state-mismatch":
      return unexpected(
        "the state the app sent",
        "a different state, so this may not be a response to the app's request",
      );
    case "iss-missing":
      return unexpected(`iss naming ${pending.issuer}, which the provider says it sends`, "no iss");
    case "iss-mismatch":
      return unexpected(`iss naming ${pending.issuer}`, `iss naming ${problem.stated}`);
    case "refused":
      return unexpected(
        "a code",
        `error ${problem.error}${problem.description === null ? "" : `: ${problem.description}`}`,
      );
    case "no-code":
      return unexpected("a code", "no code and no error");
    case "rejected":
      return unexpected("a response oauth4webapi accepts", problem.message);
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No verdict for ${JSON.stringify(unhandled)}`);
    }
  }
}
