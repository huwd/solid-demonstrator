/**
 * Requests to the Pod, made as the logged-in person.
 *
 * Each request carries the access token in `Authorization: DPoP …` and a
 * fresh DPoP proof, signed with the app's key, naming this request's method
 * and URL. A Pod checks the proof matches the request and the token's key,
 * so a copied token or proof can't be used for anything else (RFC 9449).
 *
 * oauth4webapi makes the proofs and handles a Pod asking for a DPoP nonce
 * (decision 0014). Its requests go through the traced fetch, so the token is
 * redacted and each request recorded.
 */

import {
  type Client,
  customFetch,
  DPoP,
  type DPoPHandle,
  isDPoPNonceError,
  protectedResourceRequest,
} from "oauth4webapi";
import type { Session } from "./token-exchange.ts";
import type { Trace } from "./trace.ts";
import type { RequestDescription, TracedFetch, TracedResponse } from "./traced-fetch.ts";

export interface PodRequest {
  readonly describe: RequestDescription;
  readonly url: URL;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** The Pod's answer, whatever its status, or why there wasn't one. */
export type PodResponse = TracedResponse;

export type PodFetch = (request: PodRequest) => Promise<PodResponse>;

const describeNonceRetry =
  "The Pod asked for a fresh nonce in the DPoP proof, so the app signs a new proof with it and asks again.";

/**
 * A fetch for one session. It keeps one DPoP handle, so a nonce the Pod
 * gives is used in the proofs that follow.
 */
export function createPodFetch(
  tracedFetch: TracedFetch,
  session: Pick<Session, "accessToken" | "dpopKeyPair">,
  trace: Pick<Trace, "settle">,
): PodFetch {
  // The client is used only for clock skew, which the app doesn't set.
  const client: Client = { client_id: "" };
  const dpop: DPoPHandle = DPoP(client, session.dpopKeyPair);

  return async (request) => {
    const send = async (describe: RequestDescription): Promise<PodResponse> => {
      // What the traced fetch returned, kept for when oauth4webapi throws.
      const last: { response: PodResponse | null } = { response: null };
      try {
        await protectedResourceRequest(
          session.accessToken,
          request.method ?? "GET",
          request.url,
          new Headers(request.headers),
          request.body ?? null,
          {
            DPoP: dpop,
            [customFetch]: async (url, init) => {
              const traced = await tracedFetch({
                describe,
                url: new URL(url),
                method: init.method,
                headers: init.headers as Record<string, string>,
                ...(typeof init.body === "string" ? { body: init.body } : {}),
              });
              last.response = traced;
              if (!traced.ok) {
                throw new TypeError(traced.diagnosis.summary);
              }
              return new Response(nullBodyStatus(traced.status) ? null : traced.text, {
                status: traced.status,
                headers: traced.headers,
              });
            },
          },
        );
      } catch (error) {
        const response = last.response;
        // Nothing was sent, so this is a fault in the app's own request.
        if (response === null) {
          throw error;
        }
        // Otherwise it's a refusal with a challenge, or a failed request: still
        // the answer to report.
        if (isDPoPNonceError(error)) {
          throw new NonceRequested(response);
        }
        return response;
      }
      // The custom fetch ran, or protectedResourceRequest would have thrown.
      return last.response as PodResponse;
    };

    try {
      return await send(request.describe);
    } catch (error) {
      if (!(error instanceof NonceRequested)) {
        throw error;
      }
      // Asking for a nonce is part of the protocol, not a failure.
      trace.settle(error.response.entry.id, { kind: "as-expected" });
      return send({
        ...request.describe,
        purpose: `${request.describe.purpose} Again, with the nonce the Pod asked for.`,
        explanation: describeNonceRetry,
      });
    }
  };
}

class NonceRequested extends Error {
  readonly response: PodResponse;
  constructor(response: PodResponse) {
    super("The Pod asked for a DPoP nonce.");
    this.response = response;
  }
}

/** Statuses whose responses can't have a body, which `new Response` refuses. */
function nullBodyStatus(status: number): boolean {
  return status === 204 || status === 205 || status === 304;
}
