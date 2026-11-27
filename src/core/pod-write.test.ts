import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createResource,
  deleteResource,
  ensureScratchFolder,
  isInside,
  scratchFolder,
  updateResource,
} from "./pod-write.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch, type TracedFetch } from "./traced-fetch.ts";

const storage = new URL("https://pod.example/alice/");
const note = new URL("https://pod.example/alice/solid-demonstrator/note.txt");

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string | null;
}

function setUp(answer: ((sent: Sent) => Response) | null): {
  trace: Trace;
  tracedFetch: TracedFetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 10 });
  const tracedFetch = createTracedFetch({
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const record = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body === null ? null : await request.text(),
      };
      sent.push(record);
      if (answer === null) {
        throw new TypeError("fetch failed");
      }
      return answer(record);
    },
    trace,
    timeoutMs: 1000,
    recordedTextMax: 100_000,
  });
  return { trace, tracedFetch, sent };
}

const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response(null, { status: code, headers });

describe("createResource", () => {
  it("creates with If-None-Match: *, so it never replaces anything", async () => {
    const { trace, tracedFetch, sent } = setUp(status(201, { etag: '"v1"' }));
    const result = await createResource(
      tracedFetch,
      note,
      { contentType: "text/plain", body: "Hello" },
      trace,
    );
    assert.deepEqual(result, { ok: true, url: note, etag: '"v1"' });
    assert.equal(sent[0]?.method, "PUT");
    assert.equal(sent[0]?.headers.get("if-none-match"), "*");
    assert.equal(sent[0]?.headers.get("content-type"), "text/plain");
    assert.equal(sent[0]?.body, "Hello");
    assert.equal(trace.entries()[0]?.purpose, "Create a resource in the Pod.");
    assert.deepEqual(trace.entries()[0]?.verdict, { kind: "as-expected" });
  });

  it("explains a refusal because something is already there", async () => {
    const { trace, tracedFetch } = setUp(status(412));
    const folder = new URL("https://pod.example/alice/solid-demonstrator/notes/");
    const result = await createResource(
      tracedFetch,
      folder,
      { contentType: "text/turtle", body: "" },
      trace,
    );
    assert.deepEqual(result, { ok: false, problem: { kind: "exists" } });
    assert.equal(trace.entries()[0]?.purpose, "Create a folder in the Pod.");
    const verdict = trace.entries()[0]?.verdict;
    assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", /already there/);
  });
});

describe("updateResource", () => {
  it("saves only the version the person read, with If-Match", async () => {
    const { trace, tracedFetch, sent } = setUp(status(205, { etag: '"v2"' }));
    const result = await updateResource(
      tracedFetch,
      note,
      '"v1"',
      { contentType: "text/plain", body: "Hello again" },
      trace,
    );
    assert.deepEqual(result, { ok: true, url: note, etag: '"v2"' });
    assert.equal(sent[0]?.headers.get("if-match"), '"v1"');
    assert.match(trace.entries()[0]?.explanation ?? "", /"v1"/);
  });

  it("explains a refusal because someone changed it first", async () => {
    const { trace, tracedFetch } = setUp(status(412));
    const result = await updateResource(
      tracedFetch,
      note,
      '"v1"',
      { contentType: "text/plain", body: "x" },
      trace,
    );
    assert.deepEqual(result, { ok: false, problem: { kind: "changed" } });
  });
});

describe("deleteResource", () => {
  it("deletes, checking the version where it's known", async () => {
    const { trace, tracedFetch, sent } = setUp(status(204));
    assert.deepEqual(await deleteResource(tracedFetch, note, '"v1"', trace), {
      ok: true,
      url: note,
      etag: null,
    });
    assert.equal(sent[0]?.method, "DELETE");
    assert.equal(sent[0]?.headers.get("if-match"), '"v1"');
  });

  it("deletes without a check when the Pod sent no version, and says so", async () => {
    const { trace, tracedFetch, sent } = setUp(status(204));
    await deleteResource(tracedFetch, note, null, trace);
    assert.equal(sent[0]?.headers.get("if-match"), null);
    assert.match(trace.entries()[0]?.explanation ?? "", /sent no version/);
  });

  for (const [code, problem] of [
    [401, { kind: "unauthenticated" }],
    [403, { kind: "forbidden" }],
    [404, { kind: "not-found" }],
    [409, { kind: "not-empty" }],
    [412, { kind: "changed" }],
    [500, { kind: "http-error", status: 500 }],
    [300, { kind: "http-error", status: 300 }],
  ] as const) {
    it(`explains a ${code}`, async () => {
      const { trace, tracedFetch } = setUp(status(code));
      assert.deepEqual(await deleteResource(tracedFetch, note, null, trace), {
        ok: false,
        problem,
      });
      assert.equal(trace.entries()[0]?.verdict.kind, "unexpected");
    });
  }

  it("reports a request that failed", async () => {
    const { trace, tracedFetch } = setUp(null);
    const result = await deleteResource(tracedFetch, note, null, trace);
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "request-failed");
  });
});

describe("ensureScratchFolder", () => {
  it("creates the scratch folder", async () => {
    const { trace, tracedFetch, sent } = setUp(status(201));
    assert.deepEqual(await ensureScratchFolder(tracedFetch, storage, trace), {
      ok: true,
      url: scratchFolder(storage),
      created: true,
    });
    assert.equal(sent[0]?.url, "https://pod.example/alice/solid-demonstrator/");
  });

  it("uses the folder already there, and counts that as expected", async () => {
    const { trace, tracedFetch } = setUp(status(412));
    assert.deepEqual(await ensureScratchFolder(tracedFetch, storage, trace), {
      ok: true,
      url: scratchFolder(storage),
      created: false,
    });
    assert.deepEqual(trace.entries()[0]?.verdict, { kind: "as-expected" });
  });

  it("explains a Pod that won't let the app create it", async () => {
    const { trace, tracedFetch } = setUp(status(403));
    assert.deepEqual(await ensureScratchFolder(tracedFetch, storage, trace), {
      ok: false,
      problem: { kind: "forbidden" },
    });
  });
});

describe("isInside", () => {
  it("tells what's in the scratch folder from what isn't", () => {
    const folder = scratchFolder(storage);
    assert.equal(isInside(folder, folder), true);
    assert.equal(isInside(note, folder), true);
    assert.equal(isInside(storage, folder), false);
    assert.equal(
      isInside(new URL("https://pod.example/alice/solid-demonstrator-other/"), folder),
      false,
    );
  });
});
