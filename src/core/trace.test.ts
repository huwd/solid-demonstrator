import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTrace, type EntryInput, type TraceEntry } from "./trace.ts";

const fixedNow = () => new Date("2026-11-27T12:00:00.000Z");

const profileFetch: EntryInput = {
  step: "fetchWebIdProfile",
  from: "app",
  to: "webid-profile",
  purpose: "Read the WebID profile, to find the identity providers and Pods it names.",
  provenance: "seen",
};

describe("createTrace", () => {
  it("numbers entries in order, stamps them, and starts them pending", () => {
    const trace = createTrace({ now: fixedNow, entriesMax: 10 });
    const first = trace.add(profileFetch);
    const second = trace.add({ ...profileFetch, step: "discoverIssuer" });
    assert.equal(first.id, 1);
    assert.equal(second.id, 2);
    assert.equal(first.at, "2026-11-27T12:00:00.000Z");
    assert.deepEqual(first.verdict, { kind: "pending" });
    assert.deepEqual(first.decodedTokens, []);
    assert.deepEqual(
      trace.entries().map((entry) => entry.step),
      ["fetchWebIdProfile", "discoverIssuer"],
    );
  });

  it("carries on from restored entries, numbering after them", () => {
    const before = createTrace({ now: fixedNow, entriesMax: 10 });
    before.add(profileFetch);
    const saved: TraceEntry[] = JSON.parse(JSON.stringify(before.entries()));

    const after = createTrace({ now: fixedNow, entriesMax: 10, restored: saved });
    const next = after.add({ ...profileFetch, step: "returnFromLogin" });
    assert.equal(next.id, 2);
    assert.deepEqual(
      after.entries().map((entry) => entry.step),
      ["fetchWebIdProfile", "returnFromLogin"],
    );
  });

  it("keeps a verdict and decoded tokens given when the entry is added", () => {
    const trace = createTrace({ now: fixedNow, entriesMax: 10 });
    const entry = trace.add({
      ...profileFetch,
      provenance: "explained",
      verdict: { kind: "as-expected" },
      decodedTokens: [{ label: "access token", header: {}, claims: { webid: "x" } }],
    });
    assert.deepEqual(entry.verdict, { kind: "as-expected" });
    assert.equal(entry.decodedTokens.length, 1);
  });

  it("settles an entry's verdict without changing the others", () => {
    const trace = createTrace({ now: fixedNow, entriesMax: 10 });
    const first = trace.add(profileFetch);
    trace.add(profileFetch);
    const settled = trace.settle(first.id, {
      kind: "unexpected",
      expected: "a Turtle profile",
      actual: "an HTML page",
    });
    assert.equal(settled.verdict.kind, "unexpected");
    assert.deepEqual(
      trace.entries().map((entry) => entry.verdict.kind),
      ["unexpected", "pending"],
    );
  });

  it("refuses to settle an entry it doesn't have", () => {
    const trace = createTrace({ now: fixedNow, entriesMax: 10 });
    assert.throws(() => trace.settle(7, { kind: "as-expected" }), /no entry 7/);
  });

  it("refuses entries beyond its maximum", () => {
    const trace = createTrace({ now: fixedNow, entriesMax: 1 });
    trace.add(profileFetch);
    assert.throws(() => trace.add(profileFetch), /maximum of 1 entries/);
  });

  it("tells subscribers about every change until they unsubscribe", () => {
    const trace = createTrace({ now: fixedNow, entriesMax: 10 });
    const seen: (readonly TraceEntry[])[] = [];
    const unsubscribe = trace.subscribe((entries) => seen.push(entries));
    const entry = trace.add(profileFetch);
    trace.settle(entry.id, { kind: "as-expected" });
    unsubscribe();
    trace.add(profileFetch);
    assert.equal(seen.length, 2, "one call for the add and one for the settle, none after");
    assert.equal(seen[1]?.[0]?.verdict.kind, "as-expected");
  });

  it("never changes a list of entries it has already handed out", () => {
    const trace = createTrace({ now: fixedNow, entriesMax: 10 });
    const entry = trace.add(profileFetch);
    const before = trace.entries();
    trace.settle(entry.id, { kind: "as-expected" });
    assert.equal(before[0]?.verdict.kind, "pending");
  });
});
