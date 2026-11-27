import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { generateDpopKeyPair, loginScope, prepareLogin } from "./login.ts";

const configuration = {
  issuer: "https://id.example",
  authorizationEndpoint: new URL("https://id.example/auth?tenant=demo"),
  issParameterSupported: true,
};
const client = {
  clientId: "https://app.example/clientid.jsonld",
  redirectUri: "https://app.example/",
};

describe("prepareLogin", () => {
  it("sends the person to the authorization endpoint with every parameter", async () => {
    const { authorizationUrl, pending } = await prepareLogin(configuration, client);
    assert.equal(authorizationUrl.origin + authorizationUrl.pathname, "https://id.example/auth");
    assert.equal(pending.authorizationUrl, authorizationUrl.href);
    const parameters = Object.fromEntries(authorizationUrl.searchParams);
    assert.deepEqual(parameters, {
      tenant: "demo",
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      scope: loginScope,
      code_challenge: parameters["code_challenge"],
      code_challenge_method: "S256",
      state: pending.state,
      nonce: pending.nonce,
      prompt: "consent",
    });
    assert.equal(loginScope, "openid webid");
  });

  it("sends only the verifier's SHA-256 hash, keeping the verifier", async () => {
    const { authorizationUrl, pending } = await prepareLogin(configuration, client);
    const expected = createHash("sha256").update(pending.codeVerifier).digest("base64url");
    assert.equal(authorizationUrl.searchParams.get("code_challenge"), expected);
    assert.doesNotMatch(authorizationUrl.href, new RegExp(pending.codeVerifier));
  });

  it("keeps what the return will need, for this issuer and client", async () => {
    const { pending } = await prepareLogin(configuration, client);
    assert.equal(pending.issuer, "https://id.example");
    assert.equal(pending.issParameterSupported, true);
    assert.equal(pending.clientId, client.clientId);
    assert.equal(pending.redirectUri, client.redirectUri);
    for (const secret of [pending.codeVerifier, pending.state, pending.nonce]) {
      assert.match(secret, /^[A-Za-z0-9_-]{43,}$/, "at least 256 bits, base64url");
    }
  });

  it("makes fresh secrets for every login", async () => {
    const first = await prepareLogin(configuration, client);
    const second = await prepareLogin(configuration, client);
    assert.notEqual(first.pending.codeVerifier, second.pending.codeVerifier);
    assert.notEqual(first.pending.state, second.pending.state);
    assert.notEqual(first.pending.nonce, second.pending.nonce);
  });
});

describe("generateDpopKeyPair", () => {
  it("makes a P-256 key whose private half can't be exported", async () => {
    const { privateKey, publicKey } = await generateDpopKeyPair();
    assert.equal(privateKey.extractable, false);
    assert.deepEqual(privateKey.algorithm, { name: "ECDSA", namedCurve: "P-256" });
    await assert.rejects(crypto.subtle.exportKey("jwk", privateKey));
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    assert.equal(jwk.kty, "EC");
    assert.equal(jwk.d, undefined, "the public key holds no private part");
  });
});
