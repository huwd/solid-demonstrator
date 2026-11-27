/**
 * Real signed tokens for tests, made with WebCrypto as identity providers
 * make them, so redaction is tested against the values it will meet.
 */

export async function signTestJwt(claims: Readonly<Record<string, unknown>>): Promise<string> {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = encode({ alg: "ES256", typ: "at+jwt", kid: "test-key" });
  const payload = encode({ iss: "https://id.example", iat: 1_795_000_000, ...claims });
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

/** The token's signature segment, which must never appear in a trace. */
export function signatureOf(token: string): string {
  const signature = token.split(".")[2];
  if (signature === undefined || signature === "") {
    throw new Error("Not a signed JWT.");
  }
  return signature;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
