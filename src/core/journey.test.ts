import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chaptersOf, describeFound, journeyOf, laneName, lanes, otherParty } from "./journey.ts";
import { entry, journeyEntries } from "./test-support/journey-entries.ts";

describe("journeyOf", () => {
  const journey = journeyOf(journeyEntries);

  it("puts each exchange in its chapter, with its host and status", () => {
    assert.deepEqual(
      journey.exchanges.map((exchange) => exchange.chapter),
      [
        "discovery",
        "discovery",
        "login",
        "login",
        "login",
        "login",
        "login",
        "login",
        "pod",
        "pod",
        "pod",
        "notifications",
        "notifications",
        "notifications",
      ],
    );
    const write = journey.exchanges[10];
    assert.equal(write?.host, "pod.example");
    assert.equal(write?.status, 403);
    assert.equal(write?.verdict, "unexpected");
    assert.equal(journey.exchanges[2]?.host, null);
    assert.equal(journey.exchanges[2]?.status, null);
  });

  it("finds the parties in order, with their hosts, refusals and explained steps", () => {
    assert.deepEqual(journey.found, [
      { party: "app", hosts: [], marked: false, explained: 1 },
      { party: "webid-profile", hosts: ["pod.example"], marked: false, explained: 0 },
      { party: "identity-provider", hosts: ["broker.example"], marked: false, explained: 1 },
      { party: "pod", hosts: ["pod.example"], marked: true, explained: 0 },
      { party: "notification-service", hosts: ["pod.example"], marked: false, explained: 0 },
    ]);
  });

  it("keeps the chapter before an unknown step, or starts with discovery", () => {
    const steps = journeyOf([
      entry(1, "somethingNew", "app", "pod", "seen"),
      entry(2, "exchangeCode", "app", "identity-provider", "seen"),
      entry(3, "somethingElse", "app", "pod", "seen", { url: "not a url" }),
      entry(4, "returnFromIdentityProvider", "identity-provider", "app", "reconstructed", {
        url: "https://demonstrator.example/?code=x",
      }),
    ]);
    assert.deepEqual(
      steps.exchanges.map((exchange) => [exchange.chapter, exchange.host]),
      [
        ["discovery", null],
        ["login", null],
        ["login", null],
        ["login", null],
      ],
    );
  });

  it("finds only the app before anything happens", () => {
    assert.deepEqual(journeyOf([]), {
      exchanges: [],
      found: [{ party: "app", hosts: [], marked: false, explained: 0 }],
    });
  });
});

describe("otherParty", () => {
  it("names the party that isn't the app", () => {
    assert.equal(otherParty({ from: "app", to: "pod" }), "pod");
    assert.equal(otherParty({ from: "notification-service", to: "app" }), "notification-service");
    assert.equal(otherParty({ from: "app", to: "app" }), "app");
  });
});

describe("describeFound", () => {
  it("says which parties have been found, in words", () => {
    assert.equal(describeFound(journeyOf([])), "Nothing found yet.");
    assert.equal(
      describeFound(journeyOf(journeyEntries.slice(0, 1))),
      "Found so far: your WebID profile.",
    );
    assert.equal(
      describeFound(journeyOf(journeyEntries)),
      "Found so far: your WebID profile, 1 identity provider, 1 Pod and 1 notification service.",
    );
  });

  it("counts every host of a kind of party", () => {
    const journey = journeyOf([
      entry(1, "discoverIssuer", "app", "identity-provider", "seen", {
        url: "https://one.example/",
      }),
      entry(2, "discoverIssuer", "app", "identity-provider", "seen", {
        url: "https://two.example/",
      }),
      entry(3, "discoverIssuer", "app", "identity-provider", "seen", {
        url: "https://two.example/x",
      }),
      entry(4, "fetchWebIdProfile", "app", "webid-profile", "seen", { url: "https://a.example/" }),
      entry(5, "fetchWebIdProfile", "app", "webid-profile", "seen", { url: "https://b.example/" }),
    ]);
    assert.equal(
      describeFound(journey),
      "Found so far: 2 WebID profiles and 2 identity providers.",
    );
  });
});

describe("chaptersOf", () => {
  it("groups exchanges into chapters, each with a sentence on what happened", () => {
    assert.deepEqual(
      chaptersOf(journeyOf(journeyEntries)).map(({ chapter, title, exchanges, summary }) => [
        chapter,
        title,
        exchanges.length,
        summary,
      ]),
      [
        ["discovery", "Discovery", 2, "2 steps, all as expected."],
        ["login", "Login", 6, "6 steps, all as expected."],
        ["pod", "Reading and writing", 3, "3 steps. 1 went other than expected."],
        ["notifications", "Notifications", 3, "3 steps, all as expected."],
      ],
    );
  });

  it("counts what went wrong, or what's still waiting", () => {
    const failed = { kind: "failed", diagnosis: { kind: "unreachable", summary: "x" } } as const;
    const summaries = (entries: Parameters<typeof journeyOf>[0]) =>
      chaptersOf(journeyOf(entries)).map((chapter) => chapter.summary);
    assert.deepEqual(
      summaries([
        entry(1, "readContainer", "app", "pod", "seen", { verdict: failed }),
        entry(2, "readContainer", "app", "pod", "seen", { verdict: failed }),
      ]),
      ["2 steps. 2 went other than expected."],
    );
    assert.deepEqual(
      summaries([
        entry(1, "readContainer", "app", "pod", "seen", { verdict: { kind: "pending" } }),
      ]),
      ["1 step. 1 is still waiting for an answer."],
    );
    assert.deepEqual(
      summaries([
        entry(1, "readContainer", "app", "pod", "seen", { verdict: { kind: "pending" } }),
        entry(2, "readContainer", "app", "pod", "seen", { verdict: { kind: "pending" } }),
      ]),
      ["2 steps. 2 are still waiting for an answer."],
    );
  });
});

describe("laneName", () => {
  it("names each lane briefly", () => {
    assert.deepEqual(lanes.map(laneName), ["App", "Profile", "Provider", "Pod", "Notices"]);
  });
});
