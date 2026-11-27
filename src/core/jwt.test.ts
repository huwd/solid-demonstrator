import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeJwt } from "./jwt.ts";
import { signTestJwt } from "./test-support/tokens.ts";

function segment(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("decodeJwt", () => {
  it("reads the header and claims of a signed token", async () => {
    const token = await signTestJwt({ webid: "https://alice.example/profile#me", aud: "solid" });
    const decoded = decodeJwt(token);
    assert.ok(decoded, "a real ES256 token decodes");
    assert.equal(decoded.header["alg"], "ES256");
    assert.equal(decoded.claims["webid"], "https://alice.example/profile#me");
  });

  it("reads claims containing characters outside ASCII", () => {
    const token = `${segment('{"alg":"none"}')}.${segment('{"name":"Siân"}')}.`;
    assert.equal(decodeJwt(token)?.claims["name"], "Siân");
  });

  it("returns null for values that aren't three segments", () => {
    assert.equal(decodeJwt("opaque-access-token"), null);
    assert.equal(decodeJwt("a.b.c.d"), null);
  });

  it("returns null when a segment isn't base64url", () => {
    assert.equal(decodeJwt(`${segment("{}")}.not+base64.sig`), null);
    assert.equal(decodeJwt(`.${segment("{}")}.sig`), null);
  });

  it("returns null when a segment isn't a JSON object", () => {
    assert.equal(decodeJwt(`${segment("{}")}.${segment("[1,2]")}.sig`), null);
    assert.equal(decodeJwt(`${segment("null")}.${segment("{}")}.sig`), null);
    assert.equal(decodeJwt(`${segment("not json")}.${segment("{}")}.sig`), null);
  });

  it("returns null when a segment isn't UTF-8", () => {
    const invalid = Buffer.from([0xff, 0xfe]).toString("base64url");
    assert.equal(decodeJwt(`${segment("{}")}.${invalid}.sig`), null);
  });
});
