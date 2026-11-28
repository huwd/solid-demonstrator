import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { glossary } from "./glossary.ts";

describe("glossary", () => {
  it("gives each term once, with a meaning in full sentences", () => {
    const terms = glossary.map((entry) => entry.term);
    assert.equal(new Set(terms).size, terms.length);
    for (const entry of glossary) {
      assert.match(entry.meaning, /^[A-Z].*\.$/, entry.term);
    }
  });
});
