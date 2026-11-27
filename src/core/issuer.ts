/**
 * Discovery, step 2: asking an identity provider how to log in with it.
 *
 * Every Solid-OIDC identity provider publishes a discovery document at
 * `/.well-known/openid-configuration` under its issuer. It names the
 * endpoints the login uses and says which features the provider supports.
 */

import type { Diagnosis, Trace } from "./trace.ts";
import type { TracedFetch } from "./traced-fetch.ts";
import { isAllowedScheme } from "./webid.ts";

export interface IssuerConfiguration {
  /** The issuer, exactly as both the profile and the provider write it. */
  readonly issuer: string;
  readonly authorizationEndpoint: URL;
  readonly tokenEndpoint: URL;
  readonly jwksUri: URL;
  readonly registrationEndpoint: URL | null;
  /** Whether the provider accepts a Client ID Document as its `client_id` (decision 0009). */
  readonly clientIdDocuments: boolean;
  /**
   * Whether the provider names itself in `iss` when it sends the person
   * back, so the app can check the response came from it (RFC 9207).
   */
  readonly issParameterSupported: boolean;
  /** How the provider may sign ID tokens, as it states them; empty if it doesn't say. */
  readonly idTokenSigningAlgs: readonly string[];
  /** Features the demonstrator's login needs that the provider doesn't say it offers. */
  readonly gaps: readonly IssuerGap[];
}

export type IssuerGap =
  | "no-webid-scope"
  | "no-pkce-s256"
  | "no-dpop-es256"
  | "no-way-to-identify-the-app";

export type IssuerProblem =
  | { readonly kind: "not-fetchable" }
  | { readonly kind: "request-failed"; readonly diagnosis: Diagnosis }
  | { readonly kind: "http-error"; readonly status: number }
  | { readonly kind: "too-large"; readonly length: number }
  | { readonly kind: "not-json" }
  | { readonly kind: "issuer-mismatch"; readonly stated: unknown }
  | { readonly kind: "bad-endpoint"; readonly field: string };

export type IssuerResult =
  | { readonly ok: true; readonly configuration: IssuerConfiguration }
  | { readonly ok: false; readonly problem: IssuerProblem };

/** Discovery documents are a few kilobytes; anything this size is not one. */
const documentLengthMax = 100_000;

const gapDescriptions: Record<IssuerGap, string> = {
  "no-webid-scope": "the webid scope",
  "no-pkce-s256": "PKCE with S256",
  "no-dpop-es256": "DPoP proofs signed with ES256",
  "no-way-to-identify-the-app": "Client ID Documents or dynamic client registration",
};

/** The URL of an issuer's discovery document, or null if it can't be fetched. */
export function discoveryUrl(issuer: string): URL | null {
  const url = URL.parse(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  return url !== null && isAllowedScheme(url) && url.search === "" && url.hash === "" ? url : null;
}

export async function discoverIssuer(
  tracedFetch: TracedFetch,
  issuer: string,
  trace: Pick<Trace, "settle">,
): Promise<IssuerResult> {
  const url = discoveryUrl(issuer);
  if (url === null) {
    return { ok: false, problem: { kind: "not-fetchable" } };
  }
  const response = await tracedFetch({
    describe: {
      step: "discoverIssuer",
      from: "app",
      to: "identity-provider",
      purpose:
        "Fetch the identity provider's discovery document, to find where to send the login and what the provider supports.",
      explanation: `The profile names ${issuer} as an identity provider. Each provider publishes its configuration at /.well-known/openid-configuration under its issuer.`,
      specification: "https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig",
    },
    url,
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    return { ok: false, problem: { kind: "request-failed", diagnosis: response.diagnosis } };
  }

  const refuse = (problem: IssuerProblem, expected: string, actual: string): IssuerResult => {
    trace.settle(response.entry.id, { kind: "unexpected", expected, actual });
    return { ok: false, problem };
  };

  if (response.status !== 200) {
    return refuse(
      { kind: "http-error", status: response.status },
      "200 OK",
      `${response.status}: no discovery document at this address`,
    );
  }
  if (response.text.length > documentLengthMax) {
    return refuse(
      { kind: "too-large", length: response.text.length },
      `a document of at most ${documentLengthMax} characters`,
      `${response.text.length} characters`,
    );
  }
  const document = parseObject(response.text);
  if (document === null) {
    return refuse({ kind: "not-json" }, "a JSON object", "a response that isn't a JSON object");
  }
  if (document["issuer"] !== issuer) {
    return refuse(
      { kind: "issuer-mismatch", stated: document["issuer"] },
      `the issuer ${issuer}, character for character, so tokens from another provider can't be passed off as this one's`,
      `the issuer ${JSON.stringify(document["issuer"]) ?? "(missing)"}`,
    );
  }

  const authorizationEndpoint = readEndpoint(document, "authorization_endpoint");
  const tokenEndpoint = readEndpoint(document, "token_endpoint");
  const jwksUri = readEndpoint(document, "jwks_uri");
  const registrationEndpoint =
    document["registration_endpoint"] === undefined
      ? null
      : readEndpoint(document, "registration_endpoint");
  for (const endpoint of [authorizationEndpoint, tokenEndpoint, jwksUri, registrationEndpoint]) {
    if (endpoint !== null && !(endpoint instanceof URL)) {
      return refuse(
        { kind: "bad-endpoint", field: endpoint.field },
        `${endpoint.field} as an HTTPS address`,
        endpoint.actual,
      );
    }
  }

  const clientIdDocuments = document["client_id_metadata_document_supported"] === true;
  const gaps = findGaps(document, clientIdDocuments || registrationEndpoint !== null);
  trace.settle(
    response.entry.id,
    gaps.length === 0
      ? { kind: "as-expected" }
      : {
          kind: "unexpected",
          expected: `support for ${Object.values(gapDescriptions).join(", ")}`,
          actual: `no stated support for ${gaps.map((gap) => gapDescriptions[gap]).join(", ")}`,
        },
  );
  return {
    ok: true,
    configuration: {
      issuer,
      // The loop above has returned unless every endpoint is a URL or absent.
      authorizationEndpoint: authorizationEndpoint as URL,
      tokenEndpoint: tokenEndpoint as URL,
      jwksUri: jwksUri as URL,
      registrationEndpoint: registrationEndpoint as URL | null,
      clientIdDocuments,
      issParameterSupported: document["authorization_response_iss_parameter_supported"] === true,
      idTokenSigningAlgs: strings(document["id_token_signing_alg_values_supported"]),
      gaps,
    },
  };
}

/** An endpoint the demonstrator may call, or what's wrong with it. */
function readEndpoint(
  document: Record<string, unknown>,
  field: string,
): URL | { readonly field: string; readonly actual: string } {
  const value = document[field];
  const endpoint = typeof value === "string" ? URL.parse(value) : null;
  if (endpoint !== null && isAllowedScheme(endpoint)) {
    return endpoint;
  }
  return {
    field,
    actual: value === undefined ? `no ${field}` : `${field} of ${JSON.stringify(value)}`,
  };
}

function findGaps(document: Record<string, unknown>, canIdentifyApp: boolean): IssuerGap[] {
  const gaps: IssuerGap[] = [];
  if (!listIncludes(document["scopes_supported"], "webid")) {
    gaps.push("no-webid-scope");
  }
  if (!listIncludes(document["code_challenge_methods_supported"], "S256")) {
    gaps.push("no-pkce-s256");
  }
  if (!listIncludes(document["dpop_signing_alg_values_supported"], "ES256")) {
    gaps.push("no-dpop-es256");
  }
  if (!canIdentifyApp) {
    gaps.push("no-way-to-identify-the-app");
  }
  return gaps;
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function listIncludes(list: unknown, wanted: string): boolean {
  return Array.isArray(list) && list.includes(wanted);
}

/** The strings in a discovery list, or none if it isn't a list. */
function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
