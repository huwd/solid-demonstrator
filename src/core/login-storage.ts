/**
 * What the app keeps in session storage while the person is at their
 * identity provider: the pending login and the trace so far (decision 0008).
 * Session storage belongs to the tab, so another tab can't pick it up.
 *
 * Nothing kept here is a token. The code verifier, `state` and `nonce` are
 * the login's own secrets, needed only once, and removed as soon as the
 * person comes back.
 */

import type { PendingLogin } from "./login.ts";
import type { TraceEntry } from "./trace.ts";

export interface SavedLogin {
  readonly pending: PendingLogin;
  /** The trace before the redirect, already redacted. */
  readonly entries: readonly TraceEntry[];
}

/** The part of the Web Storage interface the app uses. */
export type LoginStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The storage key, versioned so an old shape is never misread. */
export const loginStorageKey = "solid-demonstrator.login.v1";

export function saveLogin(storage: LoginStorage, saved: SavedLogin): void {
  storage.setItem(loginStorageKey, JSON.stringify(saved));
}

/**
 * Reads the saved login and removes it, so a login's secrets are used once.
 * Returns null if nothing was saved, or what was saved isn't a login.
 */
export function takeLogin(storage: LoginStorage): SavedLogin | null {
  const text = storage.getItem(loginStorageKey);
  storage.removeItem(loginStorageKey);
  if (text === null) {
    return null;
  }
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    return null;
  }
  return isSavedLogin(saved) ? saved : null;
}

const pendingStrings = [
  "issuer",
  "authorizationUrl",
  "tokenEndpoint",
  "clientId",
  "redirectUri",
  "codeVerifier",
  "state",
  "nonce",
] as const;

function isSavedLogin(value: unknown): value is SavedLogin {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { pending, entries } = value as Record<string, unknown>;
  if (typeof pending !== "object" || pending === null || !Array.isArray(entries)) {
    return false;
  }
  const fields = pending as Record<string, unknown>;
  return (
    pendingStrings.every((name) => typeof fields[name] === "string") &&
    typeof fields["issParameterSupported"] === "boolean" &&
    Array.isArray(fields["idTokenSigningAlgs"]) &&
    fields["idTokenSigningAlgs"].every((alg) => typeof alg === "string")
  );
}
