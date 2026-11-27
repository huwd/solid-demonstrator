import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { redactRequest, redactResponse } from "./redaction.ts";
import { signatureOf, signTestJwt } from "./test-support/tokens.ts";
import type { RecordedRequest, RecordedResponse } from "./trace.ts";

const webId = "https://alice.example/profile#me";
const refreshToken = "rt-7c1d9e0b4f6a2c8e5d3b1a9f7e5c3a1b";
const dpopProof = "eyJ0eXAiOiJkcG9wK2p3dCJ9.eyJodG0iOiJHRVQifQ.c2lnbmF0dXJl";

let accessToken: string;
let idToken: string;

before(async () => {
  accessToken = await signTestJwt({ webid: webId, aud: "solid", cnf: { jkt: "thumbprint" } });
  idToken = await signTestJwt({ sub: webId, azp: "https://app.example/clientid.jsonld" });
});

function request(overrides: Partial<RecordedRequest>): RecordedRequest {
  return {
    method: "GET",
    url: "https://pod.example/",
    headers: [],
    body: { kind: "none" },
    ...overrides,
  };
}

function response(overrides: Partial<RecordedResponse>): RecordedResponse {
  return { status: 200, statusText: "OK", headers: [], body: { kind: "none" }, ...overrides };
}

/** Everything a person could see or export from a redacted value. */
function shown(value: unknown): string {
  return JSON.stringify(value);
}

describe("redactResponse, for a token response", () => {
  it("removes every raw token and signature, and shows the claims instead", () => {
    const { value, decodedTokens } = redactResponse(
      response({
        body: {
          kind: "json",
          value: {
            access_token: accessToken,
            id_token: idToken,
            refresh_token: refreshToken,
            token_type: "DPoP",
            expires_in: 300,
          },
        },
      }),
    );
    const everything = shown({ value, decodedTokens });
    for (const secret of [
      accessToken,
      idToken,
      refreshToken,
      signatureOf(accessToken),
      signatureOf(idToken),
    ]) {
      assert.ok(!everything.includes(secret), `the trace must not contain ${secret.slice(0, 12)}…`);
    }
    assert.deepEqual(
      decodedTokens.map((token) => token.label),
      ["access token", "ID token"],
    );
    assert.equal(decodedTokens[0]?.claims["webid"], webId, "the access token's claims are shown");
    assert.deepEqual(value.body, {
      kind: "json",
      value: {
        access_token: "[access token removed: its claims are shown separately]",
        id_token: "[ID token removed: its claims are shown separately]",
        refresh_token: "[refresh_token hidden]",
        token_type: "DPoP",
        expires_in: 300,
      },
    });
  });

  it("removes a token that isn't a JWT, without claims to show", () => {
    const { value, decodedTokens } = redactResponse(
      response({ body: { kind: "json", value: { access_token: "opaque-token-value" } } }),
    );
    assert.deepEqual(value.body, {
      kind: "json",
      value: { access_token: "[access token removed]" },
    });
    assert.deepEqual(decodedTokens, []);
  });

  it("redacts nested objects and arrays, up to a bounded depth", () => {
    let deep: unknown = { refresh_token: refreshToken };
    for (let level = 0; level < 10; level += 1) {
      deep = { nested: deep };
    }
    const { value } = redactResponse(
      response({
        body: { kind: "json", value: { list: [{ client_secret: "s3cret" }, 4, null], deep } },
      }),
    );
    const everything = shown(value);
    assert.ok(!everything.includes("s3cret"), "a secret inside an array is hidden");
    assert.ok(!everything.includes(refreshToken), "a secret nested too deeply is not shown at all");
    assert.ok(everything.includes("[nested too deeply to show]"));
  });

  it("hides cookies set by a response", () => {
    const { value } = redactResponse(response({ headers: [["Set-Cookie", "session=abc"]] }));
    assert.deepEqual(value.headers, [["Set-Cookie", "[hidden]"]]);
  });

  it("leaves text and missing bodies as they are", () => {
    const turtle = {
      kind: "text",
      text: "<#me> a <http://xmlns.com/foaf/0.1/Person> .",
      truncated: false,
    } as const;
    assert.deepEqual(redactResponse(response({ body: turtle })).value.body, turtle);
    assert.deepEqual(redactResponse(response({ body: { kind: "unrecorded" } })).value.body, {
      kind: "unrecorded",
    });
  });
});

describe("redactRequest", () => {
  it("removes the access token from Authorization, and keeps the DPoP proof in full", () => {
    const { value, decodedTokens } = redactRequest(
      request({
        headers: [
          ["authorization", `DPoP ${accessToken}`],
          ["dpop", dpopProof],
          ["accept", "text/turtle"],
        ],
      }),
    );
    assert.deepEqual(value.headers, [
      ["authorization", "DPoP [access token removed: its claims are shown separately]"],
      ["dpop", dpopProof],
      ["accept", "text/turtle"],
    ]);
    assert.equal(decodedTokens[0]?.claims["webid"], webId);
    assert.ok(!shown(value).includes(signatureOf(accessToken)));
  });

  it("hides an Authorization header it can't parse, and cookies", () => {
    const { value } = redactRequest(
      request({
        headers: [
          ["Authorization", "malformed"],
          ["Cookie", "session=abc"],
          ["Proxy-Authorization", "Basic YWxpY2U6cGFzcw=="],
        ],
      }),
    );
    assert.deepEqual(value.headers, [
      ["Authorization", "[hidden]"],
      ["Cookie", "[hidden]"],
      ["Proxy-Authorization", "[hidden]"],
    ]);
  });

  it("shortens the code, verifier and state in a token request's form body", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const { value } = redactRequest(
      request({
        method: "POST",
        body: {
          kind: "form",
          fields: [
            ["grant_type", "authorization_code"],
            ["code", "SplxlOBeZQQYbYS6WxSbIA"],
            ["code_verifier", verifier],
            ["refresh_token", refreshToken],
          ],
        },
      }),
    );
    assert.deepEqual(value.body, {
      kind: "form",
      fields: [
        ["grant_type", "authorization_code"],
        ["code", "SplxlO… (22 characters)"],
        ["code_verifier", "dBjftJ… (43 characters)"],
        ["refresh_token", "[refresh_token hidden]"],
      ],
    });
  });

  it("redacts the query of a redirect back from the identity provider", () => {
    const { value } = redactRequest(
      request({
        url: "https://app.example/?code=SplxlOBeZQQYbYS6WxSbIA&state=af0ifjsldkj&iss=https%3A%2F%2Fid.example",
      }),
    );
    assert.equal(
      value.url,
      "https://app.example/?code=SplxlO… (22 characters)&state=af0ifj… (11 characters)&iss=https://id.example",
    );
  });

  it("redacts tokens returned in a URL fragment, keeping the query", () => {
    const { value, decodedTokens } = redactRequest(
      request({
        url: `https://app.example/callback?step=2#access_token=${accessToken}&token_type=DPoP`,
      }),
    );
    assert.equal(
      value.url,
      "https://app.example/callback?step=2#access_token=[access token removed: its claims are shown separately]&token_type=DPoP",
    );
    assert.equal(decodedTokens.length, 1);
  });

  it("leaves a URL with nothing to redact exactly as it was", () => {
    for (const url of [
      "https://alice.example/profile",
      "https://alice.example/profile?page=2",
      "https://alice.example/profile#me",
      "https://pod.example/search?q=a%20b",
    ]) {
      assert.equal(redactRequest(request({ url })).value.url, url);
    }
  });

  it("drops an empty query when only the fragment needed redacting", () => {
    const { value } = redactRequest(request({ url: "https://app.example/cb#state=af0ifjsldkj" }));
    assert.equal(value.url, "https://app.example/cb#state=af0ifj… (11 characters)");
  });

  it("keeps the method and leaves other headers alone", () => {
    const { value, decodedTokens } = redactRequest(
      request({ method: "PUT", headers: [["content-type", "text/turtle"]] }),
    );
    assert.equal(value.method, "PUT");
    assert.deepEqual(value.headers, [["content-type", "text/turtle"]]);
    assert.deepEqual(decodedTokens, []);
  });
});
