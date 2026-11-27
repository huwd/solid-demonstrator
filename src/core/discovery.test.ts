import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { discover } from "./discovery.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch, type TracedFetch } from "./traced-fetch.ts";

const wellKnown = "/.well-known/openid-configuration";
let server: Server;
let origin: string;

/** Turtle for a profile whose #me names the given issuers. */
function profileNaming(...issuers: string[]): string {
  const named = issuers.map((issuer) => `<${issuer}>`).join(", ");
  return `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
    <#me> a <http://xmlns.com/foaf/0.1/Person>${issuers.length > 0 ? ` ; solid:oidcIssuer ${named}` : ""} .`;
}

before(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? "";
    const issuer = `${origin}/good`;
    const routes: Record<string, [string, string]> = {
      "/two-providers": ["text/turtle", profileNaming(issuer, `${origin}/missing`)],
      "/no-providers": ["text/turtle", profileNaming()],
      [`/good${wellKnown}`]: [
        "application/json",
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/auth`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          scopes_supported: ["openid", "webid"],
          code_challenge_methods_supported: ["S256"],
          dpop_signing_alg_values_supported: ["ES256"],
          client_id_metadata_document_supported: true,
        }),
      ],
    };
    const route = routes[path];
    if (route === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": route[0] }).end(route[1]);
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

describe("discover", () => {
  it("stops before fetching anything if the WebID can't be used", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await discover("http://alice.example/profile#me", { tracedFetch, trace });
    assert.deepEqual(result, { ok: false, stage: "webid", problem: "not-https" });
    assert.equal(trace.entries().length, 0);
  });

  it("stops after the profile if it can't be read", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await discover(`${origin}/nobody#me`, { tracedFetch, trace });
    assert.ok(!result.ok);
    assert.equal(result.stage, "profile");
    assert.equal(result.stage === "profile" ? result.document.href : "", `${origin}/nobody`);
    assert.deepEqual(result.problem, { kind: "http-error", status: 404 });
    assert.equal(trace.entries().length, 1);
  });

  it("asks every provider the profile names, keeping the profile's order", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await discover(`  ${origin}/two-providers#me  `, { tracedFetch, trace });
    assert.ok(result.ok);
    assert.deepEqual(
      result.providers.map(({ issuer, result }) => [issuer, result.ok]),
      [
        [`${origin}/good`, true],
        [`${origin}/missing`, false],
      ],
      "one provider failing doesn't stop the other",
    );
    assert.deepEqual(
      trace.entries().map((entry) => entry.step),
      ["fetchWebIdProfile", "discoverIssuer", "discoverIssuer"],
    );
  });

  it("returns no providers for a profile that names none", async () => {
    const { trace, tracedFetch } = setUp();
    const result = await discover(`${origin}/no-providers#me`, { tracedFetch, trace });
    assert.ok(result.ok);
    assert.deepEqual(result.providers, []);
    assert.equal(trace.entries().length, 1);
  });
});
