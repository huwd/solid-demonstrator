import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { signatureOf, signTestJwt } from "./test-support/tokens.ts";
import { createTrace, type Trace } from "./trace.ts";
import {
  createTracedFetch,
  type RequestDescription,
  type TracedFetchOptions,
} from "./traced-fetch.ts";

const describeProfileFetch: RequestDescription = {
  step: "fetchWebIdProfile",
  from: "app",
  to: "webid-profile",
  purpose: "Read the WebID profile.",
  specification:
    "https://www.w3.org/2005/Incubator/webid/spec/identity/#processing-the-webid-profile",
};

const profileTurtle = "<https://alice.example/profile#me> a <http://xmlns.com/foaf/0.1/Person> .";

let server: Server;
let origin: string;
let accessToken: string;
const refreshToken = "rt-never-shown-0123456789";
let lastTokenRequestBody = "";

before(async () => {
  accessToken = await signTestJwt({ webid: "https://alice.example/profile#me" });
  server = createServer((request, response) => {
    switch (request.url) {
      case "/profile":
        response.writeHead(200, { "content-type": "text/turtle" }).end(profileTurtle);
        return;
      case "/token": {
        let body = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        request.on("end", () => {
          lastTokenRequestBody = body;
          response
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }));
        });
        return;
      }
      case "/not-json":
        response.writeHead(200, { "content-type": "application/problem+json" }).end("{oops");
        return;
      case "/moved":
        response.writeHead(301, { location: "/profile" }).end();
        return;
      case "/empty":
        response.writeHead(204).end();
        return;
      case "/slow":
        // Never answers, so the request times out.
        return;
      default:
        response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function setUp(overrides: Partial<TracedFetchOptions> = {}): {
  trace: Trace;
  tracedFetch: ReturnType<typeof createTracedFetch>;
} {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 20 });
  const tracedFetch = createTracedFetch({
    fetch: globalThis.fetch,
    trace,
    timeoutMs: 2_000,
    recordedTextMax: 10_000,
    ...overrides,
  });
  return { trace, tracedFetch };
}

describe("createTracedFetch", () => {
  it("records a request and its response, and hands the step the body", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await tracedFetch({
      describe: describeProfileFetch,
      url: new URL(`${origin}/profile`),
      headers: { accept: "text/turtle" },
    });
    assert.ok(result.ok, "the request succeeds");
    assert.equal(result.status, 200);
    assert.equal(result.text, profileTurtle);
    const [entry] = trace.entries();
    assert.ok(entry, "one entry is recorded");
    assert.equal(entry.provenance, "seen");
    assert.equal(entry.step, "fetchWebIdProfile");
    assert.equal(entry.specification, describeProfileFetch.specification);
    assert.equal(entry.request?.method, "GET");
    assert.deepEqual(entry.request?.headers, [["accept", "text/turtle"]]);
    assert.deepEqual(entry.response?.body, { kind: "text", text: profileTurtle, truncated: false });
    assert.equal(
      entry.verdict.kind,
      "pending",
      "the step, not the fetch, decides whether it was expected",
    );
  });

  it("redacts tokens before recording, but gives the step the real response", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await tracedFetch({
      describe: { ...describeProfileFetch, step: "exchangeCode", to: "identity-provider" },
      url: new URL(`${origin}/token`),
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    assert.ok(result.ok);
    assert.ok(result.text.includes(accessToken), "the step gets the token it asked for");
    assert.ok(
      lastTokenRequestBody.includes(refreshToken),
      "the server gets the real refresh token",
    );
    const recorded = JSON.stringify(trace.entries());
    for (const secret of [accessToken, refreshToken, signatureOf(accessToken)]) {
      assert.ok(!recorded.includes(secret), "no secret reaches the trace, sent or received");
    }
    assert.deepEqual(trace.entries()[0]?.request?.body, {
      kind: "form",
      fields: [
        ["grant_type", "refresh_token"],
        ["refresh_token", "[refresh_token hidden]"],
      ],
    });
    assert.equal(trace.entries()[0]?.decodedTokens[0]?.label, "access token");
  });

  it("gives the step the URL the response came from, after redirects", async () => {
    const { tracedFetch } = setUp();
    const result = await tracedFetch({
      describe: describeProfileFetch,
      url: new URL(`${origin}/moved`),
    });
    assert.ok(result.ok);
    assert.equal(result.url.href, `${origin}/profile`);
    assert.equal(result.text, profileTurtle);
  });

  it("falls back to the requested URL for a response with none", async () => {
    const builtResponse: typeof globalThis.fetch = async () => new Response("built in code");
    const { tracedFetch } = setUp({ fetch: builtResponse });
    const requested = new URL("https://alice.example/profile");
    const result = await tracedFetch({ describe: describeProfileFetch, url: requested });
    assert.ok(result.ok);
    assert.equal(result.url.href, requested.href);
  });

  it("records a text request body, cutting long bodies short in the trace only", async () => {
    const { trace, tracedFetch } = setUp({ recordedTextMax: 5 });
    const result = await tracedFetch({
      describe: describeProfileFetch,
      url: new URL(`${origin}/profile`),
      method: "PUT",
      body: "<#a> <#b> <#c> .",
    });
    assert.ok(result.ok);
    assert.equal(result.text, profileTurtle, "the step still gets the whole response");
    assert.deepEqual(trace.entries()[0]?.request?.body, {
      kind: "text",
      text: "<#a> ",
      truncated: true,
    });
    assert.deepEqual(trace.entries()[0]?.response?.body, {
      kind: "text",
      text: "<http",
      truncated: true,
    });
  });

  it("records an error status as a response, for the step to judge", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await tracedFetch({
      describe: describeProfileFetch,
      url: new URL(`${origin}/missing`),
    });
    assert.ok(result.ok, "an HTTP error is still a response");
    assert.equal(result.status, 404);
    assert.equal(trace.entries()[0]?.response?.status, 404);
  });

  it("shows a body labelled JSON that isn't as text, and an empty body as none", async () => {
    const { trace, tracedFetch } = setUp();
    await tracedFetch({ describe: describeProfileFetch, url: new URL(`${origin}/not-json`) });
    await tracedFetch({ describe: describeProfileFetch, url: new URL(`${origin}/empty`) });
    assert.deepEqual(trace.entries()[0]?.response?.body, {
      kind: "text",
      text: "{oops",
      truncated: false,
    });
    assert.deepEqual(trace.entries()[1]?.response?.body, { kind: "none" });
  });

  it("diagnoses a request with no answer as timed out", async () => {
    const { trace, tracedFetch } = setUp({ timeoutMs: 100 });
    const result = await tracedFetch({
      describe: describeProfileFetch,
      url: new URL(`${origin}/slow`),
    });
    assert.ok(!result.ok);
    assert.equal(result.diagnosis.kind, "timed-out");
    assert.match(result.diagnosis.summary, /within 0\.1 seconds/);
    assert.equal(trace.entries().length, 1, "a timeout needs no probe");
    assert.equal(trace.entries()[0]?.verdict.kind, "failed");
  });

  it("diagnoses a server that can't be reached, after probing it", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const { trace, tracedFetch } = setUp();
    const result = await tracedFetch({
      describe: describeProfileFetch,
      url: new URL(`http://127.0.0.1:${port}/profile`),
    });
    assert.ok(!result.ok);
    assert.equal(result.diagnosis.kind, "unreachable");
    const [failed, probe] = trace.entries();
    assert.equal(failed?.verdict.kind, "failed");
    assert.match(probe?.purpose ?? "", /tell a CORS refusal/);
    assert.match(probe?.explanation ?? "", /can't be reached/);
  });

  it("diagnoses a likely CORS refusal when only the probe gets an answer", async () => {
    // Node applies no CORS, so this stands in for a browser refusing to
    // share the response, then allowing an opaque no-cors request.
    const calls: RequestInit[] = [];
    const browserLikeFetch: typeof globalThis.fetch = async (_input, init) => {
      calls.push(init ?? {});
      if (init?.mode === "no-cors") {
        return new Response(null, { status: 200 });
      }
      throw new TypeError("Failed to fetch");
    };
    const { trace, tracedFetch } = setUp({ fetch: browserLikeFetch });
    const result = await tracedFetch({
      describe: describeProfileFetch,
      url: new URL("https://alice.example/profile"),
    });
    assert.ok(!result.ok);
    assert.equal(result.diagnosis.kind, "blocked-likely-cors");
    assert.match(result.diagnosis.summary, /a diagnosis, not a certainty/);
    assert.equal(calls.length, 2, "the request, then the probe");
    assert.match(trace.entries()[1]?.explanation ?? "", /server is reachable/);
  });

  it("refuses to guess about a failure it doesn't recognise", async () => {
    const strangeFetch: typeof globalThis.fetch = async () => {
      throw new RangeError("something else entirely");
    };
    const { trace, tracedFetch } = setUp({ fetch: strangeFetch });
    await assert.rejects(
      tracedFetch({
        describe: describeProfileFetch,
        url: new URL("https://alice.example/profile"),
      }),
      (error: Error) => error.cause instanceof RangeError,
    );
    assert.equal(trace.entries().length, 0);
  });
});
