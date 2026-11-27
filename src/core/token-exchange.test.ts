import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAuthResponse } from "oauth4webapi";
import { generateDpopKeyPair, type PendingLogin } from "./login.ts";
import { signatureOf, signTestJwt } from "./test-support/tokens.ts";
import { exchangeCode } from "./token-exchange.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch } from "./traced-fetch.ts";

const issuer = "https://id.example";
const webId = "https://alice.example/profile#me";

const pending: PendingLogin = {
  issuer,
  issParameterSupported: true,
  authorizationUrl: `${issuer}/auth`,
  tokenEndpoint: `${issuer}/token`,
  idTokenSigningAlgs: ["ES256"],
  clientId: "https://app.example/clientid.jsonld",
  redirectUri: "https://app.example/",
  codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  state: "state-value",
  nonce: "nonce-value-0123456789",
};

// As validated on return: the only form oauth4webapi will exchange.
const callback = validateAuthResponse(
  { issuer, authorization_response_iss_parameter_supported: true },
  { client_id: pending.clientId },
  new URLSearchParams({ code: "one-time-code-0123456789", state: pending.state, iss: issuer }),
  pending.state,
);

type Answer = (request: Request) => Response | Promise<Response>;

interface Exchange {
  readonly trace: Trace;
  readonly requests: Request[];
  readonly run: () => ReturnType<typeof exchangeCode>;
}

function setUp(...answers: Answer[]): Exchange {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 20 });
  const requests: Request[] = [];
  const tracedFetch = createTracedFetch({
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      const answer = answers.shift();
      if (answer === undefined) {
        throw new TypeError("fetch failed");
      }
      return answer(request);
    },
    trace,
    timeoutMs: 1000,
    recordedTextMax: 100_000,
  });
  return {
    trace,
    requests,
    run: async () =>
      exchangeCode(tracedFetch, pending, callback, await generateDpopKeyPair(), trace),
  };
}

async function idToken(claims: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signTestJwt({
    iss: issuer,
    aud: pending.clientId,
    sub: webId,
    webid: webId,
    nonce: pending.nonce,
    iat: now,
    exp: now + 3600,
    ...claims,
  });
}

async function tokens(extra: Record<string, unknown> = {}, idClaims = {}): Promise<Response> {
  return Response.json({
    access_token: await signTestJwt({ webid: webId, cnf: { jkt: "thumbprint" } }),
    id_token: await idToken(idClaims),
    token_type: "DPoP",
    expires_in: 300,
    ...extra,
  });
}

function decode(jwt: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const [header = "", payload = ""] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload, "base64url").toString()),
  };
}

describe("exchangeCode", () => {
  it("exchanges the code, with the verifier and a DPoP proof, for a session", async () => {
    const exchange = setUp(() => tokens());
    const result = await exchange.run();
    assert.ok(result.ok);
    assert.equal(result.session.webId, webId);
    assert.equal(result.session.issuer, issuer);
    assert.ok(result.session.expiresAt instanceof Date);

    const [request] = exchange.requests;
    assert.equal(request?.method, "POST");
    assert.equal(request?.url, `${issuer}/token`);
    const form = new URLSearchParams(await request?.text());
    assert.deepEqual(Object.fromEntries(form), {
      client_id: pending.clientId,
      code: callback.get("code"),
      code_verifier: pending.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: pending.redirectUri,
    });
    const proof = decode(request?.headers.get("dpop") ?? "");
    assert.equal(proof.header["typ"], "dpop+jwt");
    assert.equal(proof.header["alg"], "ES256");
    assert.deepEqual(Object.keys(proof.header["jwk"] as object).sort(), ["crv", "kty", "x", "y"]);
    assert.equal(proof.payload["htm"], "POST");
    assert.equal(proof.payload["htu"], `${issuer}/token`);

    const [entry] = exchange.trace.entries();
    assert.equal(entry?.step, "exchangeCode");
    assert.deepEqual(entry?.verdict, { kind: "as-expected" });
  });

  it("never records the tokens, the code or the verifier in full", async () => {
    const exchange = setUp(() => tokens());
    const result = await exchange.run();
    assert.ok(result.ok);
    const recorded = JSON.stringify(exchange.trace.entries());
    assert.doesNotMatch(recorded, new RegExp(signatureOf(result.session.accessToken)));
    assert.doesNotMatch(recorded, new RegExp(result.session.accessToken.split(".")[1] ?? "-"));
    assert.doesNotMatch(recorded, new RegExp(pending.codeVerifier));
    assert.doesNotMatch(recorded, /one-time-code-0123456789/);
  });

  it("leaves the WebID and expiry empty when the provider doesn't give them", async () => {
    const exchange = setUp(() => tokens({ expires_in: undefined }, { webid: undefined }));
    const result = await exchange.run();
    assert.ok(result.ok);
    assert.equal(result.session.webId, null);
    assert.equal(result.session.expiresAt, null);
  });

  it("sends the exchange again with the DPoP nonce the provider asks for", async () => {
    const exchange = setUp(
      () =>
        Response.json(
          { error: "use_dpop_nonce", error_description: "Use a nonce" },
          { status: 400, headers: { "dpop-nonce": "provider-nonce" } },
        ),
      () => tokens(),
    );
    const result = await exchange.run();
    assert.ok(result.ok);
    const proofs = exchange.requests.map((request) => decode(request.headers.get("dpop") ?? ""));
    assert.equal(proofs[0]?.payload["nonce"], undefined);
    assert.equal(proofs[1]?.payload["nonce"], "provider-nonce");
    const entries = exchange.trace.entries();
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0]?.verdict, { kind: "as-expected" }, "asking for a nonce is normal");
    assert.match(entries[1]?.purpose ?? "", /nonce/);
  });

  it("asks for a nonce in a WWW-Authenticate challenge too", async () => {
    const exchange = setUp(
      () =>
        new Response(null, {
          status: 401,
          headers: {
            "www-authenticate": 'DPoP error="use_dpop_nonce"',
            "dpop-nonce": "provider-nonce",
          },
        }),
      () => tokens(),
    );
    assert.ok((await exchange.run()).ok);
  });

  it("explains a refusal", async () => {
    const exchange = setUp(() =>
      Response.json({ error: "invalid_grant", error_description: "Code used" }, { status: 400 }),
    );
    const result = await exchange.run();
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      kind: "refused",
      status: 400,
      error: "invalid_grant",
      description: "Code used",
    });
    const verdict = exchange.trace.entries()[0]?.verdict;
    assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", /invalid_grant: Code used/);
  });

  it("explains a refusal without a description", async () => {
    const exchange = setUp(() => Response.json({ error: "invalid_client" }, { status: 401 }));
    const result = await exchange.run();
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, {
      kind: "refused",
      status: 401,
      error: "invalid_client",
      description: null,
    });
  });

  it("explains a challenge that isn't about a nonce", async () => {
    for (const [header, error, description] of [
      [
        'DPoP error="invalid_dpop_proof", error_description="Bad proof"',
        "invalid_dpop_proof",
        "Bad proof",
      ],
      ["DPoP", "unauthorized", null],
    ] as const) {
      const exchange = setUp(
        () => new Response(null, { status: 401, headers: { "www-authenticate": header } }),
      );
      const result = await exchange.run();
      assert.ok(!result.ok);
      assert.deepEqual(result.problem, { kind: "refused", status: 401, error, description });
    }
  });

  it("refuses a token that isn't bound to the key", async () => {
    const exchange = setUp(() => tokens({ token_type: "Bearer" }));
    const result = await exchange.run();
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, { kind: "not-dpop", tokenType: "bearer" });
    const verdict = exchange.trace.entries()[0]?.verdict;
    assert.match(verdict?.kind === "unexpected" ? verdict.actual : "", /bearer, not bound/);
  });

  it("refuses an ID token for a different login", async () => {
    const exchange = setUp(() => tokens({}, { nonce: "someone-elses" }));
    const result = await exchange.run();
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "invalid-response");
    assert.match(result.problem.kind === "invalid-response" ? result.problem.message : "", /nonce/);
    assert.equal(exchange.trace.entries()[0]?.verdict.kind, "unexpected");
  });

  it("refuses a token type it doesn't know", async () => {
    const exchange = setUp(() => tokens({ token_type: "mac" }));
    const result = await exchange.run();
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "invalid-response");
  });

  it("reports a request that failed, as the traced fetch diagnosed it", async () => {
    const exchange = setUp();
    const result = await exchange.run();
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "request-failed");
    assert.equal(
      result.problem.kind === "request-failed" ? result.problem.diagnosis.kind : null,
      "unreachable",
    );
    assert.equal(exchange.trace.entries()[0]?.verdict.kind, "failed");
  });
});
