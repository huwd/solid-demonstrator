import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { generateDpopKeyPair } from "./login.ts";
import { createPodFetch } from "./pod-fetch.ts";
import { signTestJwt } from "./test-support/tokens.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch, type RequestDescription } from "./traced-fetch.ts";

const resource = new URL("https://pod.example/alice/notes/");
const describeRead: RequestDescription = {
  step: "readContainer",
  from: "app",
  to: "pod",
  purpose: "Read a container.",
};

type Answer = (request: Request) => Response;

async function setUp(...answers: Answer[]): Promise<{
  trace: Trace;
  requests: Request[];
  accessToken: string;
  podFetch: ReturnType<typeof createPodFetch>;
}> {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 20 });
  const requests: Request[] = [];
  const tracedFetch = createTracedFetch({
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
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
  const accessToken = await signTestJwt({ webid: "https://alice.example/profile#me" });
  const podFetch = createPodFetch(
    tracedFetch,
    { accessToken, dpopKeyPair: await generateDpopKeyPair() },
    trace,
  );
  return { trace, requests, accessToken, podFetch };
}

function proofOf(request: Request | undefined): Record<string, unknown> {
  const payload = (request?.headers.get("dpop") ?? "").split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

const turtle = () =>
  new Response("<> a <http://www.w3.org/ns/ldp#Container> .", {
    headers: { "content-type": "text/turtle" },
  });

describe("createPodFetch", () => {
  it("sends the token with a DPoP proof for this request alone", async () => {
    const { requests, accessToken, podFetch, trace } = await setUp(turtle, turtle);
    const response = await podFetch({
      describe: describeRead,
      url: resource,
      headers: { accept: "text/turtle" },
    });
    assert.ok(response.ok);
    assert.equal(response.status, 200);
    assert.match(response.text, /ldp#Container/);

    const [first] = requests;
    assert.equal(first?.headers.get("authorization"), `DPoP ${accessToken}`);
    assert.equal(first?.headers.get("accept"), "text/turtle");
    const proof = proofOf(first);
    assert.equal(proof["htm"], "GET");
    assert.equal(proof["htu"], resource.href);
    assert.equal(proof["ath"], createHash("sha256").update(accessToken).digest("base64url"));

    await podFetch({ describe: describeRead, url: resource, method: "HEAD" });
    assert.notEqual(proofOf(requests[1])["jti"], proof["jti"], "a fresh proof for every request");
    assert.equal(proofOf(requests[1])["htm"], "HEAD");

    assert.doesNotMatch(
      JSON.stringify(trace.entries()),
      new RegExp(accessToken.split(".")[2] ?? "-"),
    );
  });

  it("sends a body, and reads a response that has none", async () => {
    const { requests, podFetch } = await setUp(() => new Response(null, { status: 205 }));
    const response = await podFetch({
      describe: describeRead,
      url: resource,
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "Hello",
    });
    assert.ok(response.ok);
    assert.equal(response.status, 205);
    assert.equal(await requests[0]?.text(), "Hello");
  });

  it("returns a refusal as the Pod's answer, for the step to explain", async () => {
    for (const answer of [
      () =>
        new Response("", {
          status: 401,
          headers: { "www-authenticate": 'DPoP error="invalid_token"' },
        }),
      () => new Response("Forbidden", { status: 403 }),
    ]) {
      const { podFetch } = await setUp(answer);
      const response = await podFetch({ describe: describeRead, url: resource });
      assert.ok(response.ok);
      assert.ok(response.status === 401 || response.status === 403);
    }
  });

  it("asks again with the nonce the Pod gives, and keeps it", async () => {
    const { requests, trace, podFetch } = await setUp(
      () =>
        new Response("", {
          status: 401,
          headers: { "www-authenticate": 'DPoP error="use_dpop_nonce"', "dpop-nonce": "pod-nonce" },
        }),
      turtle,
      turtle,
    );
    const response = await podFetch({ describe: describeRead, url: resource });
    assert.ok(response.ok);
    assert.equal(response.status, 200);
    assert.equal(proofOf(requests[0])["nonce"], undefined);
    assert.equal(proofOf(requests[1])["nonce"], "pod-nonce");

    const [refused, retried] = trace.entries();
    assert.deepEqual(refused?.verdict, { kind: "as-expected" });
    assert.match(retried?.purpose ?? "", /Again, with the nonce/);

    await podFetch({ describe: describeRead, url: resource });
    assert.equal(proofOf(requests[2])["nonce"], "pod-nonce", "the nonce is used again");
  });

  it("throws, sending nothing, when the app's own request is wrong", async () => {
    const trace = createTrace({ now: () => new Date(), entriesMax: 5 });
    const podFetch = createPodFetch(
      createTracedFetch({ fetch, trace, timeoutMs: 1000, recordedTextMax: 100 }),
      { accessToken: "", dpopKeyPair: await generateDpopKeyPair() },
      trace,
    );
    await assert.rejects(podFetch({ describe: describeRead, url: resource }), /accessToken/);
    assert.equal(trace.entries().length, 0);
  });

  it("reports a request that failed, as the traced fetch diagnosed it", async () => {
    const { podFetch } = await setUp();
    const response = await podFetch({ describe: describeRead, url: resource });
    assert.ok(!response.ok);
    assert.equal(response.diagnosis.kind, "unreachable");
  });
});
