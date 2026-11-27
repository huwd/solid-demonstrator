/**
 * Login, step 3: exchanging the one-time code for tokens.
 *
 * The app sends the code to the identity provider's token endpoint, with
 * the PKCE code verifier, proving it's the app that started the login, and
 * a DPoP proof, signed with the app's own key. The provider binds the
 * access token to that key, so a stolen copy of the token is no use without
 * the key, which can't be exported (decision 0008).
 *
 * oauth4webapi builds the request and checks the response (decision 0014).
 * Its requests go through the traced fetch, so each one is recorded.
 */

import {
  type AuthorizationServer,
  authorizationCodeGrantRequest,
  type Client,
  customFetch,
  DPoP,
  getValidatedIdTokenClaims,
  isDPoPNonceError,
  None,
  processAuthorizationCodeResponse,
  ResponseBodyError,
  WWWAuthenticateChallengeError,
} from "oauth4webapi";
import type { PendingLogin } from "./login.ts";
import type { Diagnosis, Trace, Verdict } from "./trace.ts";
import type { RequestDescription, TracedFetch } from "./traced-fetch.ts";

/** What the app holds after login. It's kept in memory only. */
export interface Session {
  readonly issuer: string;
  /** The WebID the identity provider says the person logged in as. */
  readonly webId: string | null;
  readonly accessToken: string;
  /** When the access token expires, if the provider said. */
  readonly expiresAt: Date | null;
  readonly dpopKeyPair: CryptoKeyPair;
}

export type ExchangeProblem =
  | { readonly kind: "request-failed"; readonly diagnosis: Diagnosis }
  | {
      readonly kind: "refused";
      readonly status: number;
      readonly error: string;
      readonly description: string | null;
    }
  | { readonly kind: "not-dpop"; readonly tokenType: string }
  | { readonly kind: "invalid-response"; readonly message: string };

export type ExchangeResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly problem: ExchangeProblem };

const specification = "https://solidproject.org/TR/oidc#tokens";

const describeExchange: RequestDescription = {
  step: "exchangeCode",
  from: "app",
  to: "identity-provider",
  purpose:
    "Exchange the one-time code for an ID token and an access token, proving with the PKCE verifier that this app started the login.",
  explanation:
    "The DPoP header is a proof signed with the app's own key, which the provider binds the access token to. The code and verifier are shortened here; the tokens in the response are shown as their claims, never in full.",
  specification,
};

const describeRetry: RequestDescription = {
  ...describeExchange,
  purpose:
    "Send the exchange again, with a DPoP proof that includes the nonce the provider asked for.",
  explanation:
    "Some providers ask for a fresh nonce in every DPoP proof, so a proof can't be made in advance and kept. The provider sent one with its refusal, and the app signs a new proof with it.",
  specification: "https://www.rfc-editor.org/rfc/rfc9449.html#name-authorization-server-provid",
};

/** Thrown inside oauth4webapi's fetch when the traced fetch had no response. */
class TracedFailure extends Error {
  readonly diagnosis: Diagnosis;
  constructor(diagnosis: Diagnosis) {
    super(diagnosis.summary);
    this.diagnosis = diagnosis;
  }
}

export async function exchangeCode(
  tracedFetch: TracedFetch,
  pending: PendingLogin,
  /** The response validated on return, holding the code. */
  callback: URLSearchParams,
  dpopKeyPair: CryptoKeyPair,
  trace: Pick<Trace, "settle">,
): Promise<ExchangeResult> {
  const server: AuthorizationServer = {
    issuer: pending.issuer,
    token_endpoint: pending.tokenEndpoint,
    id_token_signing_alg_values_supported: [...pending.idTokenSigningAlgs],
  };
  const client: Client = { client_id: pending.clientId };
  const dpop = DPoP(client, dpopKeyPair);
  let lastEntry: number | null = null;

  const attempt = (describe: RequestDescription) =>
    authorizationCodeGrantRequest(
      server,
      client,
      None(),
      callback,
      pending.redirectUri,
      pending.codeVerifier,
      {
        DPoP: dpop,
        [customFetch]: async (url, init) => {
          const response = await tracedFetch({
            describe,
            url: new URL(url),
            method: init.method,
            headers: init.headers as Record<string, string>,
            body: init.body as URLSearchParams,
          });
          lastEntry = response.entry.id;
          if (!response.ok) {
            throw new TracedFailure(response.diagnosis);
          }
          return new Response(response.text, {
            status: response.status,
            headers: response.headers,
          });
        },
      },
    );

  const settle = (verdict: Verdict): void => {
    if (lastEntry !== null) {
      trace.settle(lastEntry, verdict);
    }
  };

  try {
    let response = await attempt(describeExchange);
    let result: Awaited<ReturnType<typeof processAuthorizationCodeResponse>>;
    try {
      result = await process(server, client, response, pending.nonce);
    } catch (error) {
      if (!isDPoPNonceError(error)) {
        throw error;
      }
      settle({ kind: "as-expected" });
      response = await attempt(describeRetry);
      result = await process(server, client, response, pending.nonce);
    }

    if (result.token_type !== "dpop") {
      const problem: ExchangeProblem = { kind: "not-dpop", tokenType: result.token_type };
      settle(verdictFor(problem));
      return { ok: false, problem };
    }
    const claims = getValidatedIdTokenClaims(result);
    const webId = typeof claims?.["webid"] === "string" ? claims["webid"] : null;
    settle({ kind: "as-expected" });
    return {
      ok: true,
      session: {
        issuer: pending.issuer,
        webId,
        accessToken: result.access_token,
        expiresAt:
          typeof result.expires_in === "number"
            ? new Date(Date.now() + result.expires_in * 1000)
            : null,
        dpopKeyPair,
      },
    };
  } catch (error) {
    const problem = problemFrom(error);
    // A failed request is already marked failed by the traced fetch.
    if (problem.kind !== "request-failed") {
      settle(verdictFor(problem));
    }
    return { ok: false, problem };
  }
}

function process(
  server: AuthorizationServer,
  client: Client,
  response: Response,
  nonce: string,
): ReturnType<typeof processAuthorizationCodeResponse> {
  return processAuthorizationCodeResponse(server, client, response, {
    expectedNonce: nonce,
    requireIdToken: true,
  });
}

function problemFrom(error: unknown): ExchangeProblem {
  if (error instanceof TracedFailure) {
    return { kind: "request-failed", diagnosis: error.diagnosis };
  }
  if (error instanceof ResponseBodyError) {
    return {
      kind: "refused",
      status: error.status,
      error: error.error,
      description: error.error_description ?? null,
    };
  }
  if (error instanceof WWWAuthenticateChallengeError) {
    // Every challenge's parameters, so an error is found whichever names it.
    const parameters: Readonly<Record<string, string | undefined>> = Object.assign(
      {},
      ...error.cause.map((challenge) => challenge.parameters),
    );
    return {
      kind: "refused",
      status: error.status,
      error: parameters["error"] ?? "unauthorized",
      description: parameters["error_description"] ?? null,
    };
  }
  // oauth4webapi's checks of the response, such as the ID token's nonce.
  return { kind: "invalid-response", message: String(error).replace(/^\w*Error: /, "") };
}

function verdictFor(problem: Exclude<ExchangeProblem, { kind: "request-failed" }>): Verdict {
  const expected = "tokens bound to the app's DPoP key, with an ID token for this login";
  switch (problem.kind) {
    case "refused":
      return {
        kind: "unexpected",
        expected,
        actual: `status ${problem.status}, error ${problem.error}${problem.description === null ? "" : `: ${problem.description}`}`,
      };
    case "not-dpop":
      return {
        kind: "unexpected",
        expected,
        actual: `a token of type ${problem.tokenType}, not bound to the key`,
      };
    case "invalid-response":
      return { kind: "unexpected", expected, actual: problem.message };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No verdict for ${JSON.stringify(unhandled)}`);
    }
  }
}
