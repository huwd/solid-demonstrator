/**
 * Reading a JSON Web Token's header and claims, without verifying it.
 *
 * The demonstrator shows a token's claims in place of the token itself (see
 * docs/decisions/0005-redact-secrets-in-one-place.md). Decoding is not
 * verification: checking a signature is a separate, labelled step.
 */

export interface DecodedJwt {
  readonly header: Readonly<Record<string, unknown>>;
  readonly claims: Readonly<Record<string, unknown>>;
}

/** Returns the header and claims, or null if the value isn't a JWT. */
export function decodeJwt(token: string): DecodedJwt | null {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }
  // The length check above guarantees both segments exist.
  const header = decodeSegment(segments[0] as string);
  const claims = decodeSegment(segments[1] as string);
  if (header === null || claims === null) {
    return null;
  }
  return { header, claims };
}

function decodeSegment(segment: string): Readonly<Record<string, unknown>> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    return null;
  }
  try {
    const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return isRecord(value) ? value : null;
  } catch {
    // Not base64url, not UTF-8 or not JSON: either way, not a JWT segment.
    return null;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
