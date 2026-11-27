import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fetchWebIdProfile } from "./profile.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch, type TracedFetch } from "./traced-fetch.ts";
import { readWebId } from "./webid.ts";

const turtle = "text/turtle; charset=utf-8";

/** Paths on the test server, and what each serves. */
const documents: Record<string, { status: number; contentType?: string; body: string }> = {
  "/several": {
    status: 200,
    contentType: turtle,
    body: `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix pim: <http://www.w3.org/ns/pim/space#> .
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <#me> foaf:name "Alice" ;
        solid:oidcIssuer <https://id-one.example>, <https://id-two.example/>, <https://id-one.example> ;
        solid:oidcIssuer "https://a-literal.example" ;
        pim:storage <https://pod.example/alice/>, _:blank .
      <#someone-else> solid:oidcIssuer <https://not-for-alice.example> .
    `,
  },
  "/bare": {
    status: 200,
    contentType: turtle,
    body: "<#me> a <http://xmlns.com/foaf/0.1/Person> .",
  },
  "/moved": { status: 301, body: "" },
  "/about-someone-else": {
    status: 200,
    contentType: turtle,
    body: "<#them> a <http://xmlns.com/foaf/0.1/Person> .",
  },
  "/html": { status: 200, contentType: "text/html", body: "<!doctype html><title>Profile</title>" },
  "/no-type": { status: 200, body: "<#me> a <#Thing> ." },
  "/broken": { status: 200, contentType: turtle, body: "<#me> a <#Thing" },
  "/huge": { status: 200, contentType: turtle, body: `# ${"x".repeat(1_000_001)}` },
};

let server: Server;
let origin: string;

before(async () => {
  documents["/huwdiprose"] = {
    status: 200,
    contentType: turtle,
    body: await readFile(
      new URL("./test-support/fixtures/huwdiprose-profile.ttl", import.meta.url),
      "utf8",
    ),
  };
  server = createServer((request, response) => {
    const document = documents[request.url ?? ""];
    if (document === undefined) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    const headers: Record<string, string> =
      document.contentType === undefined ? {} : { "content-type": document.contentType };
    if (request.url === "/moved") {
      headers["location"] = "/several";
    }
    response.writeHead(document.status, headers).end(document.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

function setUp(): { trace: Trace; tracedFetch: TracedFetch } {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 10 });
  return {
    trace,
    tracedFetch: createTracedFetch({
      fetch: globalThis.fetch,
      trace,
      timeoutMs: 2_000,
      recordedTextMax: 10_000,
    }),
  };
}

function webIdAt(path: string): Extract<ReturnType<typeof readWebId>, { ok: true }> {
  const input = readWebId(`${origin}${path}#me`);
  assert.ok(input.ok, "the test WebID is valid");
  return input;
}

describe("fetchWebIdProfile", () => {
  it("reads the identity provider and Pod from a real, recorded profile", async () => {
    const { trace, tracedFetch } = setUp();
    // The recorded profile uses absolute IRIs for its real WebID, so look for that one.
    const input = {
      webId: new URL("https://huwdiprose.co.uk/profile#me"),
      profileDocument: new URL(`${origin}/huwdiprose`),
    };
    const result = await fetchWebIdProfile(tracedFetch, input, trace);
    assert.ok(result.ok, "the real profile is read");
    assert.deepEqual(
      result.profile.issuers.map((issuer) => issuer.href),
      ["https://id.huwdiprose.co.uk/"],
    );
    assert.deepEqual(
      result.profile.storages.map((storage) => storage.href),
      ["https://pod.huwdiprose.co.uk/"],
    );
    assert.equal(result.profile.name, "Huw Diprose");
    assert.equal(trace.entries()[0]?.verdict.kind, "as-expected");
  });

  it("asks for Turtle, without the fragment, and explains why", async () => {
    const { trace, tracedFetch } = setUp();
    await fetchWebIdProfile(tracedFetch, webIdAt("/bare"), trace);
    const [entry] = trace.entries();
    assert.equal(entry?.request?.url, `${origin}/bare`, "the fragment is never sent");
    assert.deepEqual(entry?.request?.headers, [["accept", "text/turtle"]]);
    assert.match(entry?.explanation ?? "", /never send the part after #/);
    assert.equal(entry?.to, "webid-profile");
  });

  it("collects each distinct identity provider and Pod for this WebID only", async () => {
    const { tracedFetch, trace } = setUp();
    const result = await fetchWebIdProfile(tracedFetch, webIdAt("/several"), trace);
    assert.ok(result.ok);
    assert.deepEqual(
      result.profile.issuers.map((issuer) => issuer.href),
      ["https://id-one.example/", "https://id-two.example/"],
      "duplicates, literals and other subjects' statements are left out",
    );
    assert.deepEqual(
      result.profile.storages.map((storage) => storage.href),
      ["https://pod.example/alice/"],
      "a blank node is not a Pod",
    );
    assert.equal(result.profile.name, "Alice");
  });

  it("returns empty lists and no name for a profile that names nothing", async () => {
    const { tracedFetch, trace } = setUp();
    const result = await fetchWebIdProfile(tracedFetch, webIdAt("/bare"), trace);
    assert.ok(result.ok, "a profile without issuers is still a profile");
    assert.deepEqual(result.profile.issuers, []);
    assert.deepEqual(result.profile.storages, []);
    assert.equal(result.profile.name, null);
  });

  it("resolves relative IRIs against the document reached after a redirect", async () => {
    const { tracedFetch, trace } = setUp();
    const input = {
      webId: new URL(`${origin}/several#me`),
      profileDocument: new URL(`${origin}/moved`),
    };
    const result = await fetchWebIdProfile(tracedFetch, input, trace);
    assert.ok(result.ok);
    assert.equal(result.profile.document.href, `${origin}/several`);
  });

  for (const [path, kind, actual] of [
    ["/missing", "http-error", /404/],
    ["/html", "not-turtle", /text\/html/],
    ["/no-type", "not-turtle", /no content type/],
    ["/broken", "unparseable", /can't be read/],
    ["/huge", "too-large", /characters/],
    ["/about-someone-else", "webid-not-described", /says nothing about this WebID/],
  ] as const) {
    it(`refuses ${path}, and marks the entry as unexpected`, async () => {
      const { tracedFetch, trace } = setUp();
      const result = await fetchWebIdProfile(tracedFetch, webIdAt(path), trace);
      assert.ok(!result.ok);
      assert.equal(result.problem.kind, kind);
      const verdict = trace.entries()[0]?.verdict;
      assert.equal(verdict?.kind, "unexpected");
      assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", actual);
    });
  }

  it("passes on the diagnosis when the profile can't be fetched at all", async () => {
    const trace = createTrace({ now: () => new Date(), entriesMax: 10 });
    const unreachable: typeof globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const tracedFetch = createTracedFetch({
      fetch: unreachable,
      trace,
      timeoutMs: 100,
      recordedTextMax: 100,
    });
    const result = await fetchWebIdProfile(tracedFetch, webIdAt("/bare"), trace);
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "request-failed");
    assert.equal(
      result.problem.kind === "request-failed" ? result.problem.diagnosis.kind : "",
      "unreachable",
    );
  });
});
