import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readWebId } from "./webid.ts";

describe("readWebId", () => {
  it("separates the WebID from the profile document it is fetched from", () => {
    const result = readWebId("https://huwdiprose.co.uk/profile#me");
    assert.ok(result.ok, "an HTTPS WebID is accepted");
    assert.equal(result.webId.href, "https://huwdiprose.co.uk/profile#me");
    assert.equal(result.profileDocument.href, "https://huwdiprose.co.uk/profile");
  });

  it("accepts a WebID without a fragment, whose document is the same URL", () => {
    const result = readWebId("https://alice.example/");
    assert.ok(result.ok, "a WebID without a fragment is accepted");
    assert.equal(result.profileDocument.href, "https://alice.example/");
  });

  it("ignores spaces around what was typed", () => {
    const result = readWebId("  https://alice.example/profile#me\n");
    assert.ok(result.ok, "surrounding whitespace is trimmed");
    assert.equal(result.webId.href, "https://alice.example/profile#me");
  });

  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
    it(`accepts HTTP on the loopback host ${host}`, () => {
      const result = readWebId(`http://${host}/profile/card#me`);
      assert.ok(result.ok, `http on ${host} is accepted for local stacks`);
    });
  }

  it("refuses HTTP anywhere else", () => {
    assert.deepEqual(readWebId("http://alice.example/profile#me"), {
      ok: false,
      problem: "not-https",
    });
  });

  it("refuses schemes other than HTTP and HTTPS", () => {
    assert.deepEqual(readWebId("mailto:alice@example.org"), { ok: false, problem: "not-https" });
  });

  it("refuses an empty entry", () => {
    assert.deepEqual(readWebId("   "), { ok: false, problem: "empty" });
  });

  it("refuses text that is not a URL", () => {
    assert.deepEqual(readWebId("alice"), { ok: false, problem: "not-a-url" });
  });

  it("refuses a URL carrying a username or password", () => {
    assert.deepEqual(readWebId("https://alice@alice.example/profile#me"), {
      ok: false,
      problem: "has-credentials",
    });
    assert.deepEqual(readWebId("https://:secret@alice.example/profile#me"), {
      ok: false,
      problem: "has-credentials",
    });
  });
});
