import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { basePath, readSiteUrl } from "./site-url.ts";

describe("readSiteUrl", () => {
  it("is unset when SITE_URL is missing or blank", () => {
    assert.equal(readSiteUrl(undefined), null);
    assert.equal(readSiteUrl("  "), null);
  });

  it("reads an HTTPS address, or HTTP on localhost", () => {
    assert.equal(
      readSiteUrl(" https://example.org/demonstrator/ ")?.href,
      "https://example.org/demonstrator/",
    );
    assert.equal(readSiteUrl("http://localhost:4173/")?.href, "http://localhost:4173/");
  });

  for (const [value, reason] of [
    ["not a url", /https:\/\//],
    ["http://example.org/", /https:\/\//],
    ["https://example.org/?x=1", /no credentials, query or fragment/],
    ["https://example.org/#top", /no credentials, query or fragment/],
    ["https://user@example.org/", /no credentials, query or fragment/],
    ["https://example.org/demonstrator", /must end with \//],
  ] as const) {
    it(`refuses ${value}`, () => {
      assert.throws(() => readSiteUrl(value), reason);
    });
  }
});

describe("basePath", () => {
  it("serves from / unless SITE_URL gives a path", () => {
    assert.equal(basePath(undefined), "/");
    assert.equal(basePath("https://example.org/"), "/");
    assert.equal(basePath("https://example.org/solid-demonstrator/"), "/solid-demonstrator/");
  });
});
