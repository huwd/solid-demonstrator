import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientMetadata } from "./client-id.ts";
import { registerClient } from "./registration.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch } from "./traced-fetch.ts";

const endpoint = new URL("https://id.example/reg");
const metadata = clientMetadata(new URL("https://app.example/"));

function setUp(answer: ((request: Request) => Response) | null): {
  trace: Trace;
  requests: Request[];
  run: () => ReturnType<typeof registerClient>;
} {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 10 });
  const requests: Request[] = [];
  const tracedFetch = createTracedFetch({
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (answer === null) {
        throw new TypeError("fetch failed");
      }
      return answer(request);
    },
    trace,
    timeoutMs: 1000,
    recordedTextMax: 100_000,
  });
  return { trace, requests, run: () => registerClient(tracedFetch, endpoint, metadata, trace) };
}

describe("registerClient", () => {
  it("sends the app's metadata and keeps the client_id it's given", async () => {
    const { trace, requests, run } = setUp(() =>
      Response.json(
        {
          client_id: "registered-client",
          registration_access_token: "secret-registration-token",
          ...metadata,
        },
        { status: 201 },
      ),
    );
    assert.deepEqual(await run(), { ok: true, clientId: "registered-client" });

    const [request] = requests;
    assert.equal(request?.method, "POST");
    assert.equal(request?.headers.get("content-type"), "application/json");
    assert.deepEqual(await request?.json(), metadata);

    const [entry] = trace.entries();
    assert.equal(entry?.step, "registerClient");
    assert.deepEqual(entry?.verdict, { kind: "as-expected" });
    assert.match(entry?.explanation ?? "", /only what the app claims/);
    assert.doesNotMatch(JSON.stringify(entry), /secret-registration-token/);
  });

  it("explains a refusal, with the provider's error", async () => {
    const { trace, run } = setUp(() =>
      Response.json(
        { error: "invalid_redirect_uri", error_description: "Not allowed" },
        { status: 400 },
      ),
    );
    assert.deepEqual(await run(), {
      ok: false,
      problem: {
        kind: "refused",
        status: 400,
        error: "invalid_redirect_uri",
        description: "Not allowed",
      },
    });
    const verdict = trace.entries()[0]?.verdict;
    assert.equal(
      verdict?.kind === "unexpected" ? verdict.actual : null,
      "400, error invalid_redirect_uri: Not allowed",
    );
  });

  it("explains a refusal without a JSON error", async () => {
    for (const body of ["Forbidden", "[]", "null"]) {
      const { trace, run } = setUp(() => new Response(body, { status: 403 }));
      assert.deepEqual(await run(), {
        ok: false,
        problem: { kind: "refused", status: 403, error: null, description: null },
      });
      const verdict = trace.entries()[0]?.verdict;
      assert.equal(verdict?.kind === "unexpected" ? verdict.actual : null, "403");
    }
  });

  it("refuses a success that gives no client_id", async () => {
    for (const body of [{}, { client_id: "" }, { client_id: 7 }]) {
      const { trace, run } = setUp(() => Response.json(body, { status: 201 }));
      assert.deepEqual(await run(), { ok: false, problem: { kind: "no-client-id" } });
      assert.equal(trace.entries()[0]?.verdict.kind, "unexpected");
    }
  });

  it("reports a request that failed", async () => {
    const { run } = setUp(null);
    const result = await run();
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "request-failed");
  });
});
