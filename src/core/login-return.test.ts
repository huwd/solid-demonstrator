import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PendingLogin } from "./login.ts";
import { isLoginReturn, returnFromLogin } from "./login-return.ts";
import { createTrace, type Trace } from "./trace.ts";

const state = "af0ifjsldkj-state-value-0123456789abcdefghij";
const code = "SplxlOBeZQQYbYS6WxSbIA-one-time-code";

const pending: PendingLogin = {
  issuer: "https://id.example",
  issParameterSupported: true,
  authorizationUrl: `https://id.example/auth?response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&state=${state}&nonce=n-0S6_WzA2Mj-nonce-value-0123456789abcdef`,
  tokenEndpoint: "https://id.example/token",
  idTokenSigningAlgs: ["ES256"],
  clientId: "https://app.example/clientid.jsonld",
  redirectUri: "https://app.example/",
  codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  state,
  nonce: "n-0S6_WzA2Mj-nonce-value-0123456789abcdef",
};

function back(query: string): URL {
  return new URL(`https://app.example/?${query}`);
}

function setUp(): Trace {
  return createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 10 });
}

const goodReturn = `code=${code}&state=${state}&iss=${encodeURIComponent("https://id.example")}`;

describe("isLoginReturn", () => {
  it("recognises a code or an error with a state", () => {
    assert.equal(isLoginReturn(back(goodReturn)), true);
    assert.equal(isLoginReturn(back(`error=access_denied&state=${state}`)), true);
  });

  it("ignores an ordinary visit, or one without a state", () => {
    assert.equal(isLoginReturn(new URL("https://app.example/")), false);
    assert.equal(isLoginReturn(back(`code=${code}`)), false);
    assert.equal(isLoginReturn(back(`state=${state}`)), false);
  });
});

describe("returnFromLogin", () => {
  it("accepts the response it asked for, ready for the exchange", () => {
    const trace = setUp();
    const result = returnFromLogin(pending, back(goodReturn), trace);
    assert.ok(result.ok);
    assert.equal(result.parameters.get("code"), code);
    assert.equal(trace.entries()[2]?.verdict.kind, "as-expected");
  });

  it("records the trip out, the part it can't see, and the trip back", () => {
    const trace = setUp();
    returnFromLogin(pending, back(goodReturn), trace);
    const entries = trace.entries();
    assert.deepEqual(
      entries.map((entry) => [entry.step, entry.provenance, entry.from, entry.to]),
      [
        ["redirectToIdentityProvider", "reconstructed", "app", "identity-provider"],
        ["loginAtIdentityProvider", "explained", "identity-provider", "identity-provider"],
        ["returnFromIdentityProvider", "reconstructed", "identity-provider", "app"],
      ],
    );
    assert.equal(entries[1]?.request, undefined, "an explained entry has no request");
    assert.match(entries[1]?.explanation ?? "", /https:\/\/id\.example's own pages/);
  });

  it("records only redacted addresses, never the code, state or nonce in full", () => {
    const trace = setUp();
    returnFromLogin(pending, back(goodReturn), trace);
    const recorded = JSON.stringify(trace.entries());
    for (const secret of [
      code,
      state,
      pending.nonce,
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    ]) {
      assert.doesNotMatch(recorded, new RegExp(secret), secret);
    }
    assert.match(trace.entries()[2]?.request?.url ?? "", /code=SplxlO… \(36 characters\)/);
  });

  for (const [description, query, problem, actual] of [
    [
      "a different state, even with an error",
      `error=access_denied&state=someone-elses-state`,
      { kind: "state-mismatch" },
      /different state/,
    ],
    [
      "no iss from a provider that says it sends one",
      `code=${code}&state=${state}`,
      { kind: "iss-missing" },
      /no iss/,
    ],
    [
      "an iss naming another provider",
      `code=${code}&state=${state}&iss=${encodeURIComponent("https://elsewhere.example")}`,
      { kind: "iss-mismatch", stated: "https://elsewhere.example" },
      /elsewhere/,
    ],
    [
      "the person declining",
      `error=access_denied&error_description=${encodeURIComponent("The person said no")}&state=${state}&iss=${encodeURIComponent("https://id.example")}`,
      { kind: "refused", error: "access_denied", description: "The person said no" },
      /access_denied: The person said no/,
    ],
    [
      "an error without a description",
      `error=server_error&state=${state}&iss=${encodeURIComponent("https://id.example")}`,
      { kind: "refused", error: "server_error", description: null },
      /^error server_error$/,
    ],
    [
      "neither a code nor an error",
      `state=${state}&iss=${encodeURIComponent("https://id.example")}`,
      { kind: "no-code" },
      /no code/,
    ],
  ] as const) {
    it(`refuses ${description}`, () => {
      const trace = setUp();
      const result = returnFromLogin(pending, back(query), trace);
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, problem);
      const verdict = trace.entries()[2]?.verdict;
      assert.equal(verdict?.kind, "unexpected");
      assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", actual);
    });
  }

  it("accepts no iss from a provider that doesn't say it sends one", () => {
    const result = returnFromLogin(
      { ...pending, issParameterSupported: false },
      back(`code=${code}&state=${state}`),
      setUp(),
    );
    assert.ok(result.ok);
  });

  it("reports what oauth4webapi refuses after the app's own checks pass", () => {
    const trace = setUp();
    const result = returnFromLogin(pending, back(`${goodReturn}&state=${state}`), trace);
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "rejected");
    assert.match(
      result.problem.kind === "rejected" ? result.problem.message : "",
      /state/,
      "a repeated parameter is refused",
    );
    const verdict = trace.entries()[2]?.verdict;
    assert.match(verdict?.kind === "unexpected" ? verdict.expected : "", /oauth4webapi/);
  });
});
