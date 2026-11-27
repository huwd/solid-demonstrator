import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateDpopKeyPair } from "./login.ts";
import { signatureOf, signTestJwt } from "./test-support/tokens.ts";
import { inspectSession, keyThumbprint, summarise } from "./token-inspection.ts";

describe("keyThumbprint", () => {
  it("matches the example in RFC 9449", async () => {
    // RFC 9449, section 6.1: the example DPoP key and its jkt.
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        x: "l8tFrhx-34tV3hRICRDY9zCkDlpBhF42UQUfWVAWBFs",
        y: "9VE4jf_Ok_o64zbTTlcuNJajHmt6v9TDVrU0CdvGRDA",
        crv: "P-256",
      },
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    assert.equal(await keyThumbprint(publicKey), "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I");
  });
});

describe("summarise", () => {
  it("reads who issued the token, who it names and is for, its times and its key", () => {
    const summary = summarise("Access token", {
      iss: "https://id.example",
      webid: "https://alice.example/profile#me",
      aud: ["solid", "https://app.example/clientid.jsonld"],
      client_id: "https://app.example/clientid.jsonld",
      iat: 1_795_000_000,
      exp: 1_795_000_300,
      cnf: { jkt: "thumbprint" },
    });
    assert.deepEqual(summary, {
      label: "Access token",
      issuer: "https://id.example",
      webId: "https://alice.example/profile#me",
      audience: ["solid", "https://app.example/clientid.jsonld"],
      clientId: "https://app.example/clientid.jsonld",
      issuedAt: new Date(1_795_000_000_000),
      expiresAt: new Date(1_795_000_300_000),
      keyThumbprint: "thumbprint",
    });
  });

  it("reads a single audience, and azp for the client", () => {
    const summary = summarise("ID token", {
      aud: "https://app.example/",
      azp: "https://app.example/",
    });
    assert.deepEqual(summary.audience, ["https://app.example/"]);
    assert.equal(summary.clientId, "https://app.example/");
  });

  it("leaves out what the token doesn't say, or says in the wrong form", () => {
    for (const claims of [{}, { aud: 7, cnf: "key", iat: "yesterday", webid: 1 }, { cnf: null }]) {
      const summary = summarise("ID token", claims);
      assert.deepEqual(summary, {
        label: "ID token",
        issuer: null,
        webId: null,
        audience: [],
        clientId: null,
        issuedAt: null,
        expiresAt: null,
        keyThumbprint: null,
      });
    }
  });
});

describe("inspectSession", () => {
  it("says whether the access token is bound to the app's own key", async () => {
    const dpopKeyPair = await generateDpopKeyPair();
    const jkt = await keyThumbprint(dpopKeyPair.publicKey);
    const idTokenClaims = { iss: "https://id.example" };

    const bound = await inspectSession({
      accessToken: await signTestJwt({ cnf: { jkt } }),
      idTokenClaims,
      dpopKeyPair,
    });
    assert.equal(bound.boundToAppKey, true);
    assert.equal(bound.appKeyThumbprint, jkt);
    assert.equal(bound.idToken.issuer, "https://id.example");

    const other = await inspectSession({
      accessToken: await signTestJwt({ cnf: { jkt: "someone-elses" } }),
      idTokenClaims,
      dpopKeyPair,
    });
    assert.equal(other.boundToAppKey, false);
  });

  it("can't say, for an access token that isn't a JWT", async () => {
    const inspection = await inspectSession({
      accessToken: "opaque-token",
      idTokenClaims: {},
      dpopKeyPair: await generateDpopKeyPair(),
    });
    assert.equal(inspection.accessToken, null);
    assert.equal(inspection.boundToAppKey, null);
  });

  it("never passes on the token or its signature", async () => {
    const accessToken = await signTestJwt({ webid: "https://alice.example/profile#me" });
    const inspection = await inspectSession({
      accessToken,
      idTokenClaims: {},
      dpopKeyPair: await generateDpopKeyPair(),
    });
    const shown = JSON.stringify(inspection);
    assert.doesNotMatch(shown, new RegExp(signatureOf(accessToken)));
    assert.doesNotMatch(shown, new RegExp(accessToken.split(".")[1] ?? "-"));
  });
});
