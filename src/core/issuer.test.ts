import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { discoverIssuer, discoveryUrl } from "./issuer.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch, type TracedFetch } from "./traced-fetch.ts";

/**
 * Real discovery documents, fetched on 2026-11-27 and stored with their
 * keys sorted. id.huwdiprose.co.uk accepts Client ID Documents;
 * solidcommunity.net offers only dynamic registration, and names itself
 * with a trailing slash.
 */
const recorded: Record<string, string> = {};

/** Discovery documents served by the test server, keyed by issuer path. */
const documents: Record<string, (issuer: string) => { status: number; body: string }> = {
  "/complete": (issuer) => ({ status: 200, body: JSON.stringify(complete(issuer)) }),
  "/registration-only": (issuer) => ({
    status: 200,
    body: JSON.stringify({
      ...complete(issuer),
      client_id_metadata_document_supported: undefined,
      registration_endpoint: `${issuer}/register`,
    }),
  }),
  "/bare": (issuer) => ({
    status: 200,
    body: JSON.stringify({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      scopes_supported: "webid",
    }),
  }),
  "/other-issuer": () => ({
    status: 200,
    body: JSON.stringify(complete("https://elsewhere.example")),
  }),
  "/no-issuer": (issuer) => ({
    status: 200,
    body: JSON.stringify({ ...complete(issuer), issuer: undefined }),
  }),
  "/no-token-endpoint": (issuer) => ({
    status: 200,
    body: JSON.stringify({ ...complete(issuer), token_endpoint: undefined }),
  }),
  "/insecure-endpoint": (issuer) => ({
    status: 200,
    body: JSON.stringify({ ...complete(issuer), token_endpoint: "http://id.example/token" }),
  }),
  "/bad-registration": (issuer) => ({
    status: 200,
    body: JSON.stringify({ ...complete(issuer), registration_endpoint: 42 }),
  }),
  "/array": () => ({ status: 200, body: "[]" }),
  "/html": () => ({ status: 200, body: "<!doctype html><title>Login</title>" }),
  "/huge": () => ({ status: 200, body: `"${"x".repeat(100_001)}"` }),
  "/broken": () => ({ status: 500, body: "Internal error" }),
};

function complete(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    scopes_supported: ["openid", "webid"],
    code_challenge_methods_supported: ["S256"],
    dpop_signing_alg_values_supported: ["ES256"],
    client_id_metadata_document_supported: true,
  };
}

const wellKnown = "/.well-known/openid-configuration";
let server: Server;
let origin: string;

before(async () => {
  for (const host of ["id-huwdiprose-co-uk", "solidcommunity-net"]) {
    const file = new URL(`./test-support/fixtures/discovery-${host}.json`, import.meta.url);
    recorded[host] = await readFile(file, "utf8");
  }
  server = createServer((request, response) => {
    const path = request.url ?? "";
    const make = path.endsWith(wellKnown) ? documents[path.slice(0, -wellKnown.length)] : undefined;
    if (make === undefined) {
      response.writeHead(404).end();
      return;
    }
    const { status, body } = make(`${origin}${path.slice(0, -wellKnown.length)}`);
    response.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

function setUp(fetch: typeof globalThis.fetch = globalThis.fetch): {
  trace: Trace;
  tracedFetch: TracedFetch;
} {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 10 });
  return {
    trace,
    tracedFetch: createTracedFetch({ fetch, trace, timeoutMs: 2_000, recordedTextMax: 10_000 }),
  };
}

/** A fetch that replays a recorded document at its real address. */
function replaying(address: string, host: string): typeof globalThis.fetch {
  return async (input) => {
    assert.equal(String(input instanceof Request ? input.url : input), address);
    return new Response(recorded[host], { headers: { "content-type": "application/json" } });
  };
}

describe("discoveryUrl", () => {
  it("adds the well-known path, with or without a trailing slash", () => {
    assert.equal(discoveryUrl("https://id.example")?.href, `https://id.example${wellKnown}`);
    assert.equal(discoveryUrl("https://id.example/")?.href, `https://id.example${wellKnown}`);
    assert.equal(
      discoveryUrl("https://example.org/idp/")?.href,
      `https://example.org/idp${wellKnown}`,
    );
  });

  it("refuses issuers it can't or mustn't fetch", () => {
    for (const issuer of [
      "not a url",
      "http://id.example",
      "https://id.example?tenant=1",
      "https://id.example#x",
    ]) {
      assert.equal(discoveryUrl(issuer), null, issuer);
    }
  });
});

describe("discoverIssuer", () => {
  it("reads a real provider that accepts Client ID Documents", async () => {
    const { trace, tracedFetch } = setUp(
      replaying(`https://id.huwdiprose.co.uk${wellKnown}`, "id-huwdiprose-co-uk"),
    );
    const result = await discoverIssuer(tracedFetch, "https://id.huwdiprose.co.uk", trace);
    assert.ok(result.ok);
    assert.equal(result.configuration.clientIdDocuments, true);
    assert.equal(result.configuration.issParameterSupported, true);
    assert.equal(result.configuration.registrationEndpoint, null);
    assert.deepEqual(result.configuration.gaps, []);
    assert.equal(result.configuration.tokenEndpoint.origin, "https://id.huwdiprose.co.uk");
    assert.equal(trace.entries()[0]?.verdict.kind, "as-expected");
  });

  it("reads a real provider that offers only registration, named with a trailing slash", async () => {
    const { trace, tracedFetch } = setUp(
      replaying(`https://solidcommunity.net${wellKnown}`, "solidcommunity-net"),
    );
    const result = await discoverIssuer(tracedFetch, "https://solidcommunity.net/", trace);
    assert.ok(result.ok);
    assert.equal(result.configuration.clientIdDocuments, false);
    assert.equal(
      result.configuration.registrationEndpoint?.href,
      "https://solidcommunity.net/.oidc/reg",
    );
    assert.deepEqual(result.configuration.gaps, []);
  });

  it("refuses the same real provider named without its trailing slash", async () => {
    const { trace, tracedFetch } = setUp(
      replaying(`https://solidcommunity.net${wellKnown}`, "solidcommunity-net"),
    );
    const result = await discoverIssuer(tracedFetch, "https://solidcommunity.net", trace);
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      kind: "issuer-mismatch",
      stated: "https://solidcommunity.net/",
    });
    const verdict = trace.entries()[0]?.verdict;
    assert.match(verdict?.kind === "unexpected" ? verdict.expected : "", /character for character/);
  });

  it("records the request and explains where the address comes from", async () => {
    const { trace, tracedFetch } = setUp();
    await discoverIssuer(tracedFetch, `${origin}/complete`, trace);
    const [entry] = trace.entries();
    assert.equal(entry?.request?.url, `${origin}/complete${wellKnown}`);
    assert.equal(entry?.to, "identity-provider");
    assert.match(entry?.explanation ?? "", /names .+\/complete as an identity provider/);
  });

  it("accepts a provider with only a registration endpoint", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await discoverIssuer(tracedFetch, `${origin}/registration-only`, trace);
    assert.ok(result.ok);
    assert.equal(
      result.configuration.registrationEndpoint?.href,
      `${origin}/registration-only/register`,
    );
    assert.equal(result.configuration.issParameterSupported, false, "not stated, so not expected");
    assert.deepEqual(result.configuration.gaps, []);
  });

  it("lists what a bare provider doesn't say it supports, and marks the entry", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await discoverIssuer(tracedFetch, `${origin}/bare`, trace);
    assert.ok(result.ok, "gaps are reported, not refused, so the interface can explain them");
    assert.deepEqual(result.configuration.gaps, [
      "no-webid-scope",
      "no-pkce-s256",
      "no-dpop-es256",
      "no-way-to-identify-the-app",
    ]);
    const verdict = trace.entries()[0]?.verdict;
    assert.equal(verdict?.kind, "unexpected");
    assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", /PKCE with S256/);
  });

  for (const [path, problem, actual] of [
    ["/broken", { kind: "http-error", status: 500 }, /500/],
    ["/missing", { kind: "http-error", status: 404 }, /404/],
    ["/huge", { kind: "too-large", length: 100_003 }, /characters/],
    ["/html", { kind: "not-json" }, /isn't a JSON object/],
    ["/array", { kind: "not-json" }, /isn't a JSON object/],
    [
      "/other-issuer",
      { kind: "issuer-mismatch", stated: "https://elsewhere.example" },
      /elsewhere/,
    ],
    ["/no-issuer", { kind: "issuer-mismatch", stated: undefined }, /\(missing\)/],
    ["/no-token-endpoint", { kind: "bad-endpoint", field: "token_endpoint" }, /no token_endpoint/],
    [
      "/insecure-endpoint",
      { kind: "bad-endpoint", field: "token_endpoint" },
      /http:\/\/id\.example/,
    ],
    ["/bad-registration", { kind: "bad-endpoint", field: "registration_endpoint" }, /42/],
  ] as const) {
    it(`refuses ${path}, and marks the entry as unexpected`, async () => {
      const { trace, tracedFetch } = setUp();
      const result = await discoverIssuer(tracedFetch, `${origin}${path}`, trace);
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, problem);
      const verdict = trace.entries()[0]?.verdict;
      assert.equal(verdict?.kind, "unexpected");
      assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", actual);
    });
  }

  it("refuses an issuer it can't fetch, without making a request", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await discoverIssuer(tracedFetch, "http://id.example", trace);
    assert.deepEqual(result, { ok: false, problem: { kind: "not-fetchable" } });
    assert.equal(trace.entries().length, 0);
  });

  it("passes on the diagnosis when the provider can't be reached", async () => {
    const { trace, tracedFetch } = setUp(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await discoverIssuer(tracedFetch, "https://id.example", trace);
    assert.ok(!result.ok);
    assert.equal(
      result.problem.kind === "request-failed" ? result.problem.diagnosis.kind : "",
      "unreachable",
    );
  });
});
