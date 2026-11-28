/** Trace entries shaped like a real journey's, for the journey tests. */

import type { Party, Provenance, TraceEntry, Verdict } from "../trace.ts";

export function entry(
  id: number,
  step: string,
  from: Party,
  to: Party,
  provenance: Provenance,
  options: { readonly url?: string; readonly status?: number; readonly verdict?: Verdict } = {},
): TraceEntry {
  return {
    id,
    step,
    from,
    to,
    provenance,
    purpose: `Step ${id}.`,
    at: `2026-11-28T12:00:${String(id).padStart(2, "0")}Z`,
    decodedTokens: [],
    verdict: options.verdict ?? { kind: "as-expected" },
    ...(options.url === undefined
      ? {}
      : { request: { method: "GET", url: options.url, headers: [], body: { kind: "none" } } }),
    ...(options.status === undefined
      ? {}
      : {
          response: { status: options.status, statusText: "", headers: [], body: { kind: "none" } },
        }),
  };
}

const refused: Verdict = { kind: "unexpected", expected: "201, created", actual: "403" };

/** Discovery, login, a read, a refused write and a subscription, on a split stack. */
export const journeyEntries: readonly TraceEntry[] = [
  entry(1, "fetchWebIdProfile", "app", "webid-profile", "seen", {
    url: "https://pod.example/alice/profile/card",
    status: 200,
  }),
  entry(2, "discoverIssuer", "app", "identity-provider", "seen", {
    url: "https://broker.example/.well-known/openid-configuration",
    status: 200,
  }),
  entry(3, "registerClient", "app", "app", "explained"),
  entry(4, "redirectToIdentityProvider", "app", "identity-provider", "reconstructed", {
    url: "https://broker.example/authorize?client_id=x",
  }),
  entry(5, "loginAtIdentityProvider", "identity-provider", "identity-provider", "explained"),
  entry(6, "returnFromIdentityProvider", "identity-provider", "app", "reconstructed"),
  entry(7, "exchangeCode", "app", "identity-provider", "seen", {
    url: "https://broker.example/token",
    status: 200,
  }),
  entry(8, "checkTokenWebId", "app", "app", "repeated"),
  entry(9, "checkPodTrust", "app", "app", "repeated"),
  entry(10, "readContainer", "app", "pod", "seen", {
    url: "https://pod.example/alice/",
    status: 200,
  }),
  entry(11, "createResource", "app", "pod", "seen", {
    url: "https://pod.example/alice/elsewhere/note.txt",
    status: 403,
    verdict: refused,
  }),
  entry(12, "subscribe", "app", "notification-service", "seen", {
    url: "https://pod.example/.notifications/WebSocketChannel2023/",
    status: 200,
  }),
  entry(13, "listen", "app", "notification-service", "seen", {
    url: "wss://pod.example/.notifications/ws/0f8e2c… (36 characters)",
  }),
  entry(14, "notification", "notification-service", "app", "seen"),
];
