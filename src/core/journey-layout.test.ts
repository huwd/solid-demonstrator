import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { journeyOf } from "./journey.ts";
import { layOutMap, mapSize } from "./journey-layout.ts";
import { entry, journeyEntries } from "./test-support/journey-entries.ts";

const inside = ([x, y]: readonly [number, number]) =>
  x >= 0 && x <= mapSize.width && y >= 0 && y <= mapSize.height;

describe("layOutMap, before anything happens", () => {
  const map = layOutMap(journeyOf([]));

  it("draws every party as a place to expect, but the app", () => {
    assert.deepEqual(
      map.cards.map((card) => [card.party, card.found, card.detail]),
      [
        ["app", true, "in your browser"],
        ["webid-profile", false, "the WebID you enter"],
        ["identity-provider", false, "named by the profile"],
        ["pod", false, "named by the profile"],
        ["notification-service", false, "named by the Pod"],
      ],
    );
  });

  it("joins the app to each with a faint line to expect", () => {
    assert.deepEqual(
      map.lines.map((line) => [line.to, line.style, line.ids.length, line.label]),
      [
        ["webid-profile", "expected", 0, null],
        ["identity-provider", "expected", 0, null],
        ["pod", "expected", 0, null],
        ["notification-service", "expected", 0, null],
      ],
    );
    assert.equal(map.loop, null);
    assert.deepEqual(map.bands, []);
  });
});

describe("layOutMap, for a whole journey", () => {
  const map = layOutMap(journeyOf(journeyEntries));
  const line = (to: string, style: string) =>
    map.lines.find(
      (candidate) => (candidate.to === to || candidate.from === to) && candidate.style === style,
    );

  it("draws a line for each direction and provenance, never for an explained step", () => {
    assert.deepEqual(
      map.lines.map((candidate) => `${candidate.from}>${candidate.to}:${candidate.style}`),
      [
        "app>webid-profile:seen",
        "app>identity-provider:seen",
        "app>identity-provider:reconstructed",
        "identity-provider>app:reconstructed",
        "app>pod:seen",
        "app>notification-service:seen",
        "notification-service>app:seen",
      ],
    );
    assert.deepEqual(line("identity-provider", "seen")?.ids, [2, 7]);
  });

  it("marks a refused exchange with its status", () => {
    const pod = line("pod", "seen");
    assert.equal(pod?.verdict, "unexpected");
    assert.equal(pod?.label, "403");
    assert.equal(map.cards.find((card) => card.party === "pod")?.marked, true);
  });

  it("draws the app's own checks as a loop", () => {
    assert.deepEqual(map.loop?.ids, [8, 9]);
    assert.equal(map.loop?.style, "repeated");
  });

  it("spreads lines sharing an edge, and points each from tail to tip", () => {
    const provider = map.lines.filter((candidate) => otherOf(candidate) === "identity-provider");
    const xs = provider.map((candidate) => candidate.points[0]?.[0]);
    assert.equal(new Set(xs).size, 3, "three lines, three places along the edge");
    const back = line("identity-provider", "reconstructed");
    const returning = map.lines.find((candidate) => candidate.from === "identity-provider");
    assert.equal(back?.points[0]?.[1], 216, "starts at the app");
    assert.equal(returning?.points.at(-1)?.[1], 216, "ends at the app");
    for (const candidate of [...map.lines, map.loop]) {
      assert.ok(candidate?.points.every(inside), JSON.stringify(candidate));
    }
  });

  it("boxes parties on one host, unless the box would enclose another", () => {
    // The profile is on pod.example too, but boxing it with the Pod would enclose the app.
    assert.deepEqual(map.bands, []);
    const split = layOutMap(
      journeyOf(journeyEntries.filter((candidate) => candidate.step !== "fetchWebIdProfile")),
    );
    assert.deepEqual(split.bands, [
      { host: "pod.example", x: 744, y: 184, width: 232, height: 296 },
    ]);
  });

  it("labels a failed exchange without a status", () => {
    const failed = { kind: "failed", diagnosis: { kind: "unreachable", summary: "x" } } as const;
    const lines = layOutMap(
      journeyOf([
        entry(1, "readContainer", "app", "pod", "seen", { status: 200 }),
        entry(2, "readContainer", "app", "pod", "seen", { verdict: failed }),
        entry(3, "readContainer", "app", "pod", "seen", { status: 200 }),
      ]),
    ).lines;
    assert.equal(lines.find((candidate) => candidate.to === "pod")?.label, "failed");
  });
});

function otherOf(line: { from: string; to: string }) {
  return line.from === "app" ? line.to : line.from;
}
