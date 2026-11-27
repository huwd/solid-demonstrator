import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateDpopKeyPair } from "./login.ts";
import { beyondSolidRule, checkPodTrust } from "./pod-trust-check.ts";
import { keyThumbprint } from "./token-inspection.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch } from "./traced-fetch.ts";

const issuer = "https://id.example";
const target = new URL("https://pod.example/alice/");
const configuration = {
  issuer,
  authorization_endpoint: `${issuer}/auth`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/jwks`,
  scopes_supported: ["openid", "webid"],
};

const signing = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const otherSigning = (await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
)) as CryptoKeyPair;
const jwks = {
  keys: [{ ...(await crypto.subtle.exportKey("jwk", signing.publicKey)), kid: "k1", alg: "ES256" }],
};
const dpopKeyPair = await generateDpopKeyPair();
const jkt = await keyThumbprint(dpopKeyPair.publicKey);

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function sign(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
  key: CryptoKey = signing.privateKey,
): Promise<string> {
  const input = `${encode({ alg: "ES256", typ: "at+jwt", kid: "k1", ...header })}.${encode(claims)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(input),
  );
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

const now = () => Math.floor(Date.now() / 1000);
const claims = () => ({
  iss: issuer,
  aud: ["solid", "https://app.example/id"],
  sub: "https://alice.example/profile#me",
  webid: "https://alice.example/profile#me",
  client_id: "https://app.example/id",
  jti: "token-1",
  iat: now(),
  exp: now() + 300,
  cnf: { jkt },
});

type Answer = Response | null;

function setUp(answers: { configuration?: Answer; jwks?: Answer } = {}): {
  trace: Trace;
  run: (accessToken: string) => ReturnType<typeof checkPodTrust>;
} {
  const trace = createTrace({ now: () => new Date(), entriesMax: 10 });
  const tracedFetch = createTracedFetch({
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const answer =
        url.pathname === "/jwks"
          ? answers.jwks === undefined
            ? Response.json(jwks)
            : answers.jwks
          : answers.configuration === undefined
            ? Response.json(configuration)
            : answers.configuration;
      if (answer === null) {
        throw new TypeError("fetch failed");
      }
      return answer;
    },
    trace,
    timeoutMs: 1000,
    recordedTextMax: 100_000,
  });
  return {
    trace,
    run: (accessToken) =>
      checkPodTrust(tracedFetch, { issuer, accessToken, dpopKeyPair }, target, trace),
  };
}

describe("checkPodTrust", () => {
  it("accepts a token and proof a Pod would, and says it repeated the Pod's checks", async () => {
    const { trace, run } = setUp();
    assert.deepEqual(await run(await sign(claims())), { ok: true });
    const [discovery, keys, checked] = trace.entries();
    assert.equal(discovery?.step, "checkPodTrust");
    assert.match(discovery?.purpose ?? "", /as the Pod will/);
    assert.equal(keys?.request?.url, `${issuer}/jwks`);
    assert.deepEqual(keys?.verdict, { kind: "as-expected" });
    assert.equal(checked?.provenance, "repeated");
    assert.deepEqual(checked?.verdict, { kind: "as-expected" });
  });

  for (const [description, token, rule] of [
    ["a typ other than at+jwt", () => sign(claims(), { typ: "JWT" }), "typ"],
    ["no jti", () => sign({ ...claims(), jti: undefined }), "jti"],
    ["no sub", () => sign({ ...claims(), sub: undefined }), "sub"],
    ["a sub that isn't a string", () => sign({ ...claims(), sub: 7 }), "sub"],
  ] as const) {
    it(`says RFC 9068, not Solid-OIDC, refuses ${description}`, async () => {
      const { trace, run } = setUp();
      const result = await run(await token());
      assert.ok(!result.ok);
      assert.equal(result.problem.kind, "beyond-solid");
      assert.equal(result.problem.kind === "beyond-solid" && result.problem.rule, rule);
      const verdict = trace.entries().at(-1)?.verdict;
      assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", /RFC 9068 refuses/);
    });
  }

  for (const [description, token, message] of [
    [
      "a token signed with another key",
      () => sign(claims(), {}, otherSigning.privateKey),
      /signature/,
    ],
    [
      "a token for another audience",
      () => sign({ ...claims(), aud: "https://other.example" }),
      /aud/,
    ],
    ["an expired token", () => sign({ ...claims(), iat: now() - 600, exp: now() - 300 }), /exp/],
    [
      "a token from another issuer",
      () => sign({ ...claims(), iss: "https://other.example" }),
      /iss/,
    ],
    [
      "a token bound to another key",
      () => sign({ ...claims(), cnf: { jkt: "x" } }),
      /confirmation/,
    ],
    ["a token bound to no key", () => sign({ ...claims(), cnf: undefined }), /cnf/],
  ] as const) {
    it(`says a Pod would refuse ${description}`, async () => {
      const { run } = setUp();
      const result = await run(await token());
      assert.ok(!result.ok);
      assert.equal(result.problem.kind, "refused");
      assert.match(result.problem.kind === "refused" ? result.problem.message : "", message);
    });
  }

  it("explains a provider whose configuration can't be read", async () => {
    const { run } = setUp({ configuration: new Response("", { status: 500 }) });
    const result = await run(await sign(claims()));
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      kind: "issuer",
      problem: { kind: "http-error", status: 500 },
    });
  });

  it("explains keys that can't be fetched", async () => {
    const { run } = setUp({ jwks: null });
    const result = await run(await sign(claims()));
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "keys-unavailable");
  });

  it("explains keys the provider won't give", async () => {
    const { trace, run } = setUp({ jwks: new Response("", { status: 404 }) });
    const result = await run(await sign(claims()));
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      kind: "keys-unavailable",
      reason: "The provider answered 404.",
    });
    assert.equal(trace.entries()[1]?.verdict.kind, "unexpected");
  });
});

describe("beyondSolidRule", () => {
  it("recognises only RFC 9068's rules beyond Solid-OIDC", () => {
    assert.equal(beyondSolidRule('JWT "client_id" (Client Identifier) claim missing'), null);
    assert.equal(beyondSolidRule("JWT signature verification failed"), null);
  });
});
