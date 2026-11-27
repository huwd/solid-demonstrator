import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Party, Provenance, Verdict } from "./trace.ts";
import {
  partyName,
  provenanceLabel,
  showBody,
  showsExchange,
  verdictLabel,
} from "./trace-format.ts";

function assertDistinct(values: readonly string[]): void {
  assert.equal(new Set(values).size, values.length, `expected distinct: ${values.join(", ")}`);
}

describe("partyName", () => {
  it("names every party differently", () => {
    const parties: Party[] = [
      "app",
      "webid-profile",
      "identity-provider",
      "pod",
      "notification-service",
    ];
    assertDistinct(parties.map(partyName));
  });
});

describe("provenanceLabel", () => {
  it("labels and explains every provenance differently", () => {
    const provenances: Provenance[] = ["seen", "reconstructed", "repeated", "explained"];
    const labels = provenances.map(provenanceLabel);
    assertDistinct(labels.map((label) => label.label));
    assertDistinct(labels.map((label) => label.meaning));
  });

  it("never lets an explained entry pass for a log", () => {
    const { label, meaning } = provenanceLabel("explained");
    assert.match(label, /not observed/);
    assert.match(meaning, /isn't a log/);
  });

  it("lays out an exchange for every provenance except explained", () => {
    const provenances: Provenance[] = ["seen", "reconstructed", "repeated", "explained"];
    assert.deepEqual(
      provenances.map((provenance) => showsExchange({ provenance })),
      [true, true, true, false],
    );
  });
});

describe("verdictLabel", () => {
  it("labels every verdict differently", () => {
    const verdicts: Verdict[] = [
      { kind: "pending" },
      { kind: "as-expected" },
      { kind: "unexpected", expected: "200 OK", actual: "404" },
      { kind: "failed", diagnosis: { kind: "unreachable", summary: "No answer." } },
    ];
    assertDistinct(verdicts.map(verdictLabel));
  });
});

describe("showBody", () => {
  it("says when there's no body, or it wasn't recorded", () => {
    assert.deepEqual(showBody({ kind: "none" }), { text: null, note: "No body." });
    assert.deepEqual(showBody({ kind: "unrecorded" }), {
      text: null,
      note: "The body wasn't recorded.",
    });
  });

  it("shows text, noting when it was cut short", () => {
    assert.deepEqual(showBody({ kind: "text", text: "<#me> a <#Person> .", truncated: false }), {
      text: "<#me> a <#Person> .",
      note: null,
    });
    assert.match(
      showBody({ kind: "text", text: "<#me>", truncated: true }).note ?? "",
      /Cut short/,
    );
  });

  it("indents JSON", () => {
    assert.equal(
      showBody({ kind: "json", value: { issuer: "https://id.example" } }).text,
      '{\n  "issuer": "https://id.example"\n}',
    );
  });

  it("puts each form field on its own line", () => {
    assert.equal(
      showBody({
        kind: "form",
        fields: [
          ["grant_type", "authorization_code"],
          ["code", "abcdef… (43 characters)"],
        ],
      }).text,
      "grant_type=authorization_code\ncode=abcdef… (43 characters)",
    );
  });
});
