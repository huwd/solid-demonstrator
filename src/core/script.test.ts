import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { journeyOf } from "./journey.ts";
import {
  aliceScript,
  chapterOfEntry,
  exampleEntries,
  exampleSecrets,
  scriptSteps,
} from "./script.ts";

const entries = exampleEntries(aliceScript);

describe("exampleEntries", () => {
  it("numbers every step in order, each with its specification", () => {
    assert.equal(entries.length, scriptSteps(aliceScript).length);
    assert.deepEqual(
      entries.map((entry) => entry.id),
      entries.map((_, index) => index + 1),
    );
    for (const entry of entries) {
      assert.match(entry.specification ?? "", /^https:\/\//, entry.step);
      assert.ok(entry.explanation, entry.step);
    }
  });

  it("never shows a secret a live session would hide", () => {
    const shown = JSON.stringify(entries);
    for (const secret of exampleSecrets) {
      assert.ok(!shown.includes(secret), `${secret.slice(0, 12)}… is shown`);
    }
  });

  it("decodes the tokens' claims, as a live session does", () => {
    const exchange = entries.find((entry) => entry.step === "exchangeCode");
    assert.deepEqual(
      exchange?.decodedTokens.map((token) => [token.label, token.claims["webid"]]),
      [
        ["access token", "https://alice.example/profile/card#me"],
        ["ID token", "https://alice.example/profile/card#me"],
      ],
    );
    const read = entries.find((entry) => entry.step === "readContainer");
    assert.equal(read?.decodedTokens[0]?.claims["aud"], "solid");
  });

  it("names only fictional hosts, besides the specifications and vocabularies", () => {
    const hosts = new Set(
      [...JSON.stringify(aliceScript).matchAll(/(?:https?|wss):\/\/([^/"\\?#>\s]+)/g)].map(
        (match) => match[1],
      ),
    );
    for (const host of hosts) {
      assert.match(
        host ?? "",
        /\.example$|^(www\.)?w3\.org$|^solidproject\.org$|^openid\.net$|^www\.rfc-editor\.org$/,
      );
    }
  });

  it("ends with the Pod's refusal, and finds every party", () => {
    assert.equal(entries.at(-1)?.verdict.kind, "unexpected");
    assert.equal(entries.at(-1)?.response?.status, 403);
    assert.deepEqual(
      journeyOf(entries).found.map((party) => [party.party, party.hosts]),
      [
        ["app", []],
        ["webid-profile", ["alice.example"]],
        ["identity-provider", ["broker.example"]],
        ["pod", ["pod.example"]],
        ["notification-service", ["pod.example"]],
      ],
    );
  });
});

describe("chapterOfEntry", () => {
  it("finds the chapter an entry belongs to", () => {
    assert.equal(chapterOfEntry(aliceScript, 0), 0);
    assert.equal(chapterOfEntry(aliceScript, 1), 1);
    assert.equal(chapterOfEntry(aliceScript, entries.length), aliceScript.length - 1);
    assert.equal(chapterOfEntry(aliceScript, entries.length + 1), aliceScript.length - 1);
  });
});
