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
  /** The Pod the person chose, to read once they're logged in; null if the profile names none. */
  readonly storage: string | null;
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
  const { pending, entries, storage } = value as Record<string, unknown>;
  if (typeof pending !== "object" || pending === null || !Array.isArray(entries)) {
    return false;
  }
  if (storage !== null && typeof storage !== "string") {
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

/** Where registered clients are kept for the tab, by issuer and redirect address. */
export const registrationsStorageKey = "solid-demonstrator.registrations.v1";

/**
 * The client_id the app registered with this issuer earlier in the tab,
 * for this redirect address, or null. Kept per redirect address, since a
 * registration is only valid for the addresses it lists.
 */
export function recallRegistration(
  storage: LoginStorage,
  issuer: string,
  redirectUri: string,
): string | null {
  const clientId = readRegistrations(storage)[registrationKey(issuer, redirectUri)];
  return typeof clientId === "string" ? clientId : null;
}

export function rememberRegistration(
  storage: LoginStorage,
  issuer: string,
  redirectUri: string,
  clientId: string,
): void {
  const registrations = {
    ...readRegistrations(storage),
    [registrationKey(issuer, redirectUri)]: clientId,
  };
  storage.setItem(registrationsStorageKey, JSON.stringify(registrations));
}

/** Forgets a registration, so the next login registers again. */
export function forgetRegistration(
  storage: LoginStorage,
  issuer: string,
  redirectUri: string,
): void {
  const { [registrationKey(issuer, redirectUri)]: _forgotten, ...rest } =
    readRegistrations(storage);
  storage.setItem(registrationsStorageKey, JSON.stringify(rest));
}

function registrationKey(issuer: string, redirectUri: string): string {
  return JSON.stringify([issuer, redirectUri]);
}

function readRegistrations(storage: LoginStorage): Readonly<Record<string, unknown>> {
  const text = storage.getItem(registrationsStorageKey);
  if (text === null) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Removes everything the app keeps in session storage, for logging out. */
export function forgetLogins(storage: LoginStorage): void {
  storage.removeItem(loginStorageKey);
  storage.removeItem(registrationsStorageKey);
}
