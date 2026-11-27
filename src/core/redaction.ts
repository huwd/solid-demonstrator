/**
 * The only place that decides what is safe to show.
 *
 * Every request and response passes through here before it is stored,
 * shown or exported. The rules are those in
 * docs/decisions/0005-redact-secrets-in-one-place.md:
 *
 * - access and ID tokens are never shown raw; their header and claims are
 *   decoded and shown instead, without the signature
 * - refresh tokens, client secrets and similar are hidden entirely
 * - authorisation codes, PKCE values and `state` are shortened
 * - DPoP proofs are shown in full, since each is single-use and bound to one
 *   request
 *
 * A new kind of credential needs a rule here before any step records it.
 */

import { decodeJwt } from "./jwt.ts";
import type {
  DecodedToken,
  Header,
  RecordedBody,
  RecordedRequest,
  RecordedResponse,
} from "./trace.ts";

export interface Redacted<T> {
  readonly value: T;
  /** Tokens found and removed, with their header and claims. */
  readonly decodedTokens: readonly DecodedToken[];
}

export function redactRequest(request: RecordedRequest): Redacted<RecordedRequest> {
  const tokens: DecodedToken[] = [];
  const value: RecordedRequest = {
    method: request.method,
    url: redactUrl(request.url, tokens),
    headers: request.headers.map((header) => redactHeader(header, tokens)),
    body: redactBody(request.body, tokens),
  };
  return { value, decodedTokens: tokens };
}

export function redactResponse(response: RecordedResponse): Redacted<RecordedResponse> {
  const tokens: DecodedToken[] = [];
  const value: RecordedResponse = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.map((header) => redactHeader(header, tokens)),
    body: redactBody(response.body, tokens),
  };
  return { value, decodedTokens: tokens };
}

/** Parameter and field names that carry a token whose claims are shown. */
const decodedNames: ReadonlyMap<string, string> = new Map([
  ["access_token", "access token"],
  ["id_token", "ID token"],
]);

/** Names whose values are never shown at all. */
const hiddenNames: ReadonlySet<string> = new Set([
  "client_secret",
  "password",
  "refresh_token",
  "registration_access_token",
]);

/** Names whose values are shown shortened, enough to match them by eye. */
const shortenedNames: ReadonlySet<string> = new Set([
  "code",
  "code_challenge",
  "code_verifier",
  "nonce",
  "state",
]);

/** Headers whose values are never shown. */
const hiddenHeaders: ReadonlySet<string> = new Set(["cookie", "proxy-authorization", "set-cookie"]);

/** Bounds the walk through a JSON body. Deeper values are not shown. */
const jsonDepthMax = 8;

/** How many characters of a shortened value to keep. */
const shortenedPrefixLength = 6;

function redactValue(name: string, value: string, tokens: DecodedToken[]): string {
  const label = decodedNames.get(name);
  if (label !== undefined) {
    return removeToken(label, value, tokens);
  }
  if (hiddenNames.has(name)) {
    return `[${name} hidden]`;
  }
  if (shortenedNames.has(name)) {
    return shorten(value);
  }
  return value;
}

function removeToken(label: string, token: string, tokens: DecodedToken[]): string {
  const decoded = decodeJwt(token);
  if (decoded === null) {
    return `[${label} removed]`;
  }
  tokens.push({ label, header: decoded.header, claims: decoded.claims });
  return `[${label} removed: its claims are shown separately]`;
}

function shorten(value: string): string {
  return `${value.slice(0, shortenedPrefixLength)}… (${value.length} characters)`;
}

function redactHeader([name, value]: Header, tokens: DecodedToken[]): Header {
  const lowerName = name.toLowerCase();
  if (hiddenHeaders.has(lowerName)) {
    return [name, "[hidden]"];
  }
  if (lowerName === "authorization") {
    const match = /^(\S+)\s+(\S+)$/.exec(value);
    const scheme = match?.[1];
    const credential = match?.[2];
    if (scheme === undefined || credential === undefined) {
      return [name, "[hidden]"];
    }
    return [name, `${scheme} ${removeToken("access token", credential, tokens)}`];
  }
  return [name, value];
}

/**
 * Redacts query and fragment parameters. The fragment matters because an
 * identity provider can return tokens there. A URL with nothing to redact is
 * returned exactly as it was.
 */
function redactUrl(href: string, tokens: DecodedToken[]): string {
  const url = new URL(href);
  const query = redactParameters(url.search.slice(1), tokens);
  const fragment = redactParameters(url.hash.slice(1), tokens);
  if (query === null && fragment === null) {
    return href;
  }
  const base = `${url.origin}${url.pathname}`;
  const search = query ?? url.search.slice(1);
  const hash = fragment ?? url.hash.slice(1);
  return `${base}${search === "" ? "" : `?${search}`}${hash === "" ? "" : `#${hash}`}`;
}

/** Returns the parameters, decoded and redacted, or null if none needed it. */
function redactParameters(encoded: string, tokens: DecodedToken[]): string | null {
  if (!encoded.includes("=")) {
    return null;
  }
  const fields = [...new URLSearchParams(encoded)];
  if (!fields.some(([name]) => isRedacted(name))) {
    return null;
  }
  return fields.map(([name, value]) => `${name}=${redactValue(name, value, tokens)}`).join("&");
}

function isRedacted(name: string): boolean {
  return decodedNames.has(name) || hiddenNames.has(name) || shortenedNames.has(name);
}

function redactBody(body: RecordedBody, tokens: DecodedToken[]): RecordedBody {
  switch (body.kind) {
    case "json":
      return { kind: "json", value: redactJson(body.value, tokens, 0) };
    case "form":
      return {
        kind: "form",
        fields: body.fields.map(
          ([name, value]) => [name, redactValue(name, value, tokens)] as const,
        ),
      };
    case "none":
    case "text":
    case "unrecorded":
      return body;
    // Unreachable: the type checker proves every kind is handled above.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = body;
      throw new Error(`Unhandled body kind: ${JSON.stringify(unhandled)}`);
    }
  }
}

function redactJson(value: unknown, tokens: DecodedToken[], depth: number): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (depth >= jsonDepthMax) {
    return "[nested too deeply to show]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, tokens, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, field]) => [
      name,
      typeof field === "string"
        ? redactValue(name, field, tokens)
        : redactJson(field, tokens, depth + 1),
    ]),
  );
}
