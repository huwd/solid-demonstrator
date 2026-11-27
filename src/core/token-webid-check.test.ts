import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTokenWebId } from "./token-webid-check.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch } from "./traced-fetch.ts";

const issuer = "https://id.example";
const webId = "https://alice.example/profile#me";

function setUp(profile: string | null): {
  trace: Trace;
  run: (token: { issuer: string; webId: string | null }) => ReturnType<typeof checkTokenWebId>;
} {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 10 });
  const tracedFetch = createTracedFetch({
    fetch: async () =>
      profile === null
        ? new Response("", { status: 404 })
        : new Response(profile, { headers: { "content-type": "text/turtle" } }),
    trace,
    timeoutMs: 1000,
    recordedTextMax: 100_000,
  });
  return { trace, run: (token) => checkTokenWebId(tracedFetch, token, trace) };
}

const naming = (...issuers: string[]) =>
  issuers.length === 0
    ? `<#me> <http://xmlns.com/foaf/0.1/name> "Alice" .`
    : `<#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> ${issuers.map((i) => `<${i}>`).join(", ")} .`;

describe("checkTokenWebId", () => {
  it("passes when the token's WebID names its issuer, and says it repeated the Pod's check", async () => {
    const { trace, run } = setUp(naming(issuer, "https://other.example"));
    assert.deepEqual(await run({ issuer, webId }), { ok: true });
    const [fetched, checked] = trace.entries();
    assert.equal(fetched?.step, "checkTokenWebId");
    assert.equal(fetched?.provenance, "seen");
    assert.match(fetched?.purpose ?? "", /named in the token/);
    assert.equal(checked?.provenance, "repeated");
    assert.match(checked?.explanation ?? "", /A Pod makes this check/);
    assert.deepEqual(checked?.verdict, { kind: "as-expected" });
  });

  for (const [description, profile, token, problem, actual] of [
    [
      "a profile naming other providers",
      naming("https://other.example"),
      { issuer, webId },
      { kind: "issuer-not-named", named: ["https://other.example"] },
      /naming https:\/\/other\.example/,
    ],
    [
      "a profile naming no provider",
      naming(),
      { issuer, webId },
      { kind: "issuer-not-named", named: [] },
      /names no identity provider/,
    ],
    [
      "a profile that can't be read",
      null,
      { issuer, webId },
      {
        kind: "profile",
        document: new URL("https://alice.example/profile"),
        problem: { kind: "http-error", status: 404 },
      },
      /couldn't read \(http-error\)/,
    ],
    [
      "a token that names no WebID",
      naming(issuer),
      { issuer, webId: null },
      { kind: "no-webid" },
      /names no WebID/,
    ],
    [
      "a WebID the app can't fetch",
      naming(issuer),
      { issuer, webId: "http://alice.example/profile#me" },
      { kind: "bad-webid", problem: "not-https" },
      /can't fetch \(not-https\)/,
    ],
  ] as const) {
    it(`fails for ${description}`, async () => {
      const { trace, run } = setUp(profile);
      const result = await run(token);
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, problem);
      const verdict = trace.entries().at(-1)?.verdict;
      assert.equal(verdict?.kind, "unexpected");
      assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", actual);
    });
  }
});
