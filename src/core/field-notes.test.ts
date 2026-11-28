import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldNote, headerNote } from "./field-notes.ts";

describe("headerNote", () => {
  it("explains a header whatever its case, and leaves others alone", () => {
    assert.match(headerNote("DPoP") ?? "", /this one request/);
    assert.match(headerNote("if-match") ?? "", /still this version/);
    assert.equal(headerNote("x-powered-by"), null);
  });
});

describe("fieldNote", () => {
  it("explains a form field, and leaves others alone", () => {
    assert.match(fieldNote("code_verifier") ?? "", /PKCE/);
    assert.equal(fieldNote("Code_verifier"), null);
  });
});
