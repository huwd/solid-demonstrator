import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readContainer, readWacAllow } from "./container.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch } from "./traced-fetch.ts";

const root = new URL("https://pod.example/alice/");

function setUp(answer: (() => Response) | null): {
  trace: Trace;
  run: () => ReturnType<typeof readContainer>;
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
  // The traced fetch stands in for the Pod's: the container step only sees responses.
  return { trace, run: () => readContainer(tracedFetch, root, trace) };
}

const turtle =
  (body: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(body, { headers: { "content-type": "text/turtle", ...headers } });

const listing = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix stat: <http://www.w3.org/ns/posix/stat#> .
<> a ldp:Container, ldp:BasicContainer ;
   ldp:contains <profile/>, <notes.txt>, <photos/> .
<notes.txt> dct:modified "2026-11-20T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
   stat:size 42 .
<photos/> a ldp:Container .`;

describe("readContainer", () => {
  it("lists what the container holds, with what the person may do there", async () => {
    const { trace, run } = setUp(
      turtle(listing, { "wac-allow": 'user="read write append control",public="read"' }),
    );
    const result = await run();
    assert.ok(result.ok);
    const { container } = result;
    assert.equal(container.url.href, root.href);
    assert.deepEqual(
      container.contains.map((item) => [item.url.href, item.isContainer, item.size]),
      [
        ["https://pod.example/alice/notes.txt", false, 42],
        ["https://pod.example/alice/photos/", true, null],
        ["https://pod.example/alice/profile/", true, null],
      ],
    );
    assert.deepEqual(container.contains[0]?.modified, new Date("2026-11-20T10:00:00Z"));
    assert.equal(container.contains[1]?.modified, null);
    assert.deepEqual(container.access, {
      user: ["read", "write", "append", "control"],
      public: ["read"],
    });
    assert.deepEqual(trace.entries()[0]?.verdict, { kind: "as-expected" });
    assert.equal(trace.entries()[0]?.to, "pod");
  });

  it("reads an empty container, without WAC-Allow", async () => {
    const { run } = setUp(turtle("<> a <http://www.w3.org/ns/ldp#BasicContainer> ."));
    const result = await run();
    assert.ok(result.ok);
    assert.deepEqual(result.container.contains, []);
    assert.equal(result.container.access, null);
  });

  it("ignores a modified date it can't read", async () => {
    const { run } = setUp(
      turtle(`<> a <http://www.w3.org/ns/ldp#Container> ; <http://www.w3.org/ns/ldp#contains> <a> .
        <a> <http://purl.org/dc/terms/modified> "last week" .`),
    );
    const result = await run();
    assert.ok(result.ok);
    assert.equal(result.container.contains[0]?.modified, null);
  });

  for (const [description, answer, problem, actual] of [
    [
      "a Pod that doesn't accept the token",
      () => new Response("", { status: 401 }),
      { kind: "unauthenticated" },
      /401/,
    ],
    [
      "a Pod that refuses this person",
      () => new Response("", { status: 403 }),
      { kind: "forbidden" },
      /403/,
    ],
    [
      "a container that isn't there",
      () => new Response("", { status: 404 }),
      { kind: "not-found" },
      /404/,
    ],
    [
      "a server error",
      () => new Response("", { status: 500 }),
      { kind: "http-error", status: 500 },
      /^500$/,
    ],
    [
      "a redirect it can't follow",
      () => new Response(null, { status: 300 }),
      { kind: "http-error", status: 300 },
      /300/,
    ],
    [
      "a response that isn't Turtle",
      () => new Response("<html>", { headers: { "content-type": "text/html" } }),
      { kind: "not-turtle", contentType: "text/html" },
      /text\/html/,
    ],
    [
      "a response with no type",
      () => new Response(null),
      { kind: "not-turtle", contentType: null },
      /content type/,
    ],
    [
      "a resource that isn't a container",
      turtle("<> a <http://www.w3.org/ns/ldp#Resource> ."),
      { kind: "not-a-container" },
      /isn't a container/,
    ],
  ] as const) {
    it(`explains ${description}`, async () => {
      const { trace, run } = setUp(answer);
      const result = await run();
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, problem);
      const verdict = trace.entries()[0]?.verdict;
      assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", actual);
    });
  }

  it("explains Turtle that can't be read", async () => {
    const { run } = setUp(turtle("<> a <unterminated"));
    const result = await run();
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "unparseable");
  });

  it("reports a request that failed", async () => {
    const { run } = setUp(null);
    const result = await run();
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "request-failed");
  });
});

describe("readWacAllow", () => {
  it("reads each group's modes, in any case and spacing", () => {
    assert.deepEqual(readWacAllow('User = "read  write", PUBLIC="", other="read"'), {
      user: ["read", "write"],
      public: [],
    });
    assert.deepEqual(readWacAllow("nonsense"), { user: [], public: [] });
    assert.equal(readWacAllow(null), null);
  });
});
