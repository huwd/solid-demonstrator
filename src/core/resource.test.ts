import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isText, readResource } from "./resource.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch } from "./traced-fetch.ts";

const url = new URL("https://pod.example/alice/notes.txt");

function setUp(answer: (() => Response) | null): {
  trace: Trace;
  run: () => ReturnType<typeof readResource>;
} {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 10 });
  const tracedFetch = createTracedFetch({
    fetch: async () => {
      if (answer === null) {
        throw new TypeError("fetch failed");
      }
      return answer();
    },
    trace,
    timeoutMs: 1000,
    recordedTextMax: 100_000,
  });
  return { trace, run: () => readResource(tracedFetch, url, trace) };
}

describe("readResource", () => {
  it("reads text, with its version and what the person may do", async () => {
    const { trace, run } = setUp(
      () =>
        new Response("Buy milk", {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-length": "8",
            etag: '"v1"',
            "wac-allow": 'user="read write",public=""',
            link: '<notes.txt.acl>; rel="acl"',
          },
        }),
    );
    const result = await run();
    assert.ok(result.ok);
    assert.deepEqual(result.resource, {
      url,
      contentType: "text/plain; charset=utf-8",
      text: "Buy milk",
      size: 8,
      etag: '"v1"',
      access: { user: ["read", "write"], public: [] },
      links: {
        isStorage: false,
        storageDescription: null,
        accessRules: new URL("https://pod.example/alice/notes.txt.acl"),
      },
    });
    assert.equal(trace.entries()[0]?.step, "readResource");
    assert.deepEqual(trace.entries()[0]?.verdict, { kind: "as-expected" });
  });

  it("describes a resource it can't show, without its body", async () => {
    const { run } = setUp(
      () => new Response("\u0089PNG", { headers: { "content-type": "image/png" } }),
    );
    const result = await run();
    assert.ok(result.ok);
    assert.equal(result.resource.text, null);
    assert.equal(result.resource.size, null);
    assert.equal(result.resource.etag, null);
    assert.equal(result.resource.access, null);
  });

  it("explains a refusal, as for a container", async () => {
    const { trace, run } = setUp(() => new Response("", { status: 403 }));
    const result = await run();
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, { kind: "forbidden" });
    assert.equal(trace.entries()[0]?.verdict.kind, "unexpected");
  });

  it("reports a request that failed", async () => {
    const { run } = setUp(null);
    const result = await run();
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "request-failed");
  });
});

describe("isText", () => {
  it("shows text and text-based data, but not images or unknown types", () => {
    for (const type of [
      "text/plain",
      "text/turtle;charset=utf-8",
      "application/json",
      "application/ld+json",
      "application/xml",
      "image/svg+xml",
      "application/n-triples",
      "application/n-quads",
      "application/trig",
    ]) {
      assert.equal(isText(type), true, type);
    }
    for (const type of [null, "", "image/png", "application/octet-stream", "application/pdf"]) {
      assert.equal(isText(type), false, String(type));
    }
  });
});
