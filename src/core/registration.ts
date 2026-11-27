/**
 * Login, for identity providers that don't read Client ID Documents: the
 * app registers itself first, with dynamic client registration, and is
 * given a client_id to log in with (outcome 3).
 *
 * The difference matters. A Client ID Document is a URL the identity
 * provider fetches, so it can check the app is served from where it says.
 * A registered client is only what the app claims about itself: any page
 * could send the same request.
 *
 * oauth4webapi has no registration helpers, so the request is built here.
 */

import type { ClientMetadata } from "./client-id.ts";
import type { Diagnosis, Trace } from "./trace.ts";
import type { TracedFetch } from "./traced-fetch.ts";

export type RegistrationProblem =
  | { readonly kind: "request-failed"; readonly diagnosis: Diagnosis }
  | {
      readonly kind: "refused";
      readonly status: number;
      readonly error: string | null;
      readonly description: string | null;
    }
  | { readonly kind: "no-client-id" };

export type RegistrationResult =
  | { readonly ok: true; readonly clientId: string }
  | { readonly ok: false; readonly problem: RegistrationProblem };

export async function registerClient(
  tracedFetch: TracedFetch,
  registrationEndpoint: URL,
  metadata: ClientMetadata,
  trace: Pick<Trace, "settle">,
): Promise<RegistrationResult> {
  const response = await tracedFetch({
    describe: {
      step: "registerClient",
      from: "app",
      to: "identity-provider",
      purpose:
        "Register the app with the identity provider, which doesn't read Client ID Documents, to be given a client_id.",
      explanation:
        "The app sends what its Client ID Document would say: its name, where to send the person back, and that it has no secret. The provider can't check any of it, since any page could send the same request, so a registered name is only what the app claims.",
      specification:
        "https://openid.net/specs/openid-connect-registration-1_0.html#ClientRegistration",
    },
    url: registrationEndpoint,
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) {
    return { ok: false, problem: { kind: "request-failed", diagnosis: response.diagnosis } };
  }

  const body = parseObject(response.text);
  const expected = "201 Created, with a client_id";
  if (response.status < 200 || response.status > 299) {
    const error = text(body["error"]);
    const description = text(body["error_description"]);
    trace.settle(response.entry.id, {
      kind: "unexpected",
      expected,
      actual: `${response.status}${error === null ? "" : `, error ${error}`}${description === null ? "" : `: ${description}`}`,
    });
    return { ok: false, problem: { kind: "refused", status: response.status, error, description } };
  }
  const clientId = text(body["client_id"]);
  if (clientId === null || clientId === "") {
    trace.settle(response.entry.id, { kind: "unexpected", expected, actual: "no client_id" });
    return { ok: false, problem: { kind: "no-client-id" } };
  }
  trace.settle(response.entry.id, { kind: "as-expected" });
  return { ok: true, clientId };
}

/** The body as a JSON object, or an empty one if it isn't. */
function parseObject(body: string): Readonly<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
