/**
 * What the tokens say, for the token inspector (outcome 3): who issued
 * them, the WebID they name, who they're for, when they expire, and the key
 * they're bound to.
 *
 * Only decoded claims leave this module, never a raw token or signature
 * (decision 0005), just as redaction shows them in the trace.
 */

import { decodeJwt } from "./jwt.ts";
import type { Session } from "./token-exchange.ts";

export interface TokenSummary {
  readonly label: string;
  readonly issuer: string | null;
  readonly webId: string | null;
  /** Who the token is for. */
  readonly audience: readonly string[];
  /** The app the token was issued to, where the provider says. */
  readonly clientId: string | null;
  readonly issuedAt: Date | null;
  readonly expiresAt: Date | null;
  /** The thumbprint of the key the token is bound to, from `cnf.jkt`. */
  readonly keyThumbprint: string | null;
}

export interface Inspection {
  /** Null when the access token isn't a JWT, so its claims can't be read. */
  readonly accessToken: TokenSummary | null;
  readonly idToken: TokenSummary;
  /** The thumbprint of the app's own DPoP public key. */
  readonly appKeyThumbprint: string;
  /** Whether the access token names the app's key; null if it can't be read. */
  readonly boundToAppKey: boolean | null;
}

export async function inspectSession(
  session: Pick<Session, "accessToken" | "idTokenClaims" | "dpopKeyPair">,
): Promise<Inspection> {
  const decoded = decodeJwt(session.accessToken);
  const accessToken = decoded === null ? null : summarise("Access token", decoded.claims);
  const appKeyThumbprint = await keyThumbprint(session.dpopKeyPair.publicKey);
  return {
    accessToken,
    idToken: summarise("ID token", session.idTokenClaims),
    appKeyThumbprint,
    boundToAppKey: accessToken === null ? null : accessToken.keyThumbprint === appKeyThumbprint,
  };
}

export function summarise(label: string, claims: Readonly<Record<string, unknown>>): TokenSummary {
  const audience = claims["aud"];
  const confirmation = claims["cnf"];
  return {
    label,
    issuer: text(claims["iss"]),
    webId: text(claims["webid"]),
    audience: Array.isArray(audience)
      ? audience.filter((item) => typeof item === "string")
      : [text(audience)].filter((item) => item !== null),
    clientId: text(claims["client_id"]) ?? text(claims["azp"]),
    issuedAt: time(claims["iat"]),
    expiresAt: time(claims["exp"]),
    keyThumbprint:
      typeof confirmation === "object" && confirmation !== null
        ? text((confirmation as Record<string, unknown>)["jkt"])
        : null,
  };
}

/** The key's JWK thumbprint (RFC 7638), as `cnf.jkt` names it (RFC 9449). */
export async function keyThumbprint(publicKey: CryptoKey): Promise<string> {
  const { crv, kty, x, y } = await crypto.subtle.exportKey("jwk", publicKey);
  // The required members only, in lexical order, with no spaces.
  const canonical = JSON.stringify({ crv, kty, x, y });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function time(value: unknown): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null;
}
