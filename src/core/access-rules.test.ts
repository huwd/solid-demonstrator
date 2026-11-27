import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acl, acp, describeAgent, describeMode, readAccessRules } from "./access-rules.ts";
import { createTrace } from "./trace.ts";
import { createTracedFetch } from "./traced-fetch.ts";

function setUp(answer: () => Response, url: URL) {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 10 });
  const tracedFetch = createTracedFetch({
    fetch: async () => answer(),
    trace,
    timeoutMs: 1000,
    recordedTextMax: 100_000,
  });
  return { trace, run: () => readAccessRules(tracedFetch, url, trace) };
}

const turtle = (body: string) => () =>
  new Response(body, { headers: { "content-type": "text/turtle" } });

const alice = "https://alice.example/profile#me";

describe("readAccessRules under Web Access Control", () => {
  it("lists each authorization, with whom it's for and where it applies", async () => {
    const url = new URL("https://pod.example/alice/.acl");
    const { trace, run } = setUp(
      turtle(`@prefix acl: <http://www.w3.org/ns/auth/acl#> .
        <#owner> a acl:Authorization ;
          acl:agent <${alice}> ;
          acl:accessTo <./> ; acl:default <./> ;
          acl:mode acl:Read, acl:Write, acl:Control .
        <#public> a acl:Authorization ;
          acl:agentClass <http://xmlns.com/foaf/0.1/Agent> ;
          acl:origin <https://app.example> ;
          acl:accessTo <./> ;
          acl:mode acl:Read .`),
      url,
    );
    const result = await run();
    assert.ok(result.ok);
    assert.equal(result.rules.system, "wac");
    assert.ok(result.rules.system === "wac");
    const [owner, everyone] = result.rules.authorizations;
    assert.deepEqual(owner, {
      id: "https://pod.example/alice/.acl#owner",
      modes: [`${acl}Read`, `${acl}Write`, `${acl}Control`],
      agents: [alice],
      agentClasses: [],
      agentGroups: [],
      origins: [],
      accessTo: ["https://pod.example/alice/"],
      defaultFor: ["https://pod.example/alice/"],
    });
    assert.deepEqual(everyone?.agentClasses, ["http://xmlns.com/foaf/0.1/Agent"]);
    assert.deepEqual(everyone?.origins, ["https://app.example"]);
    assert.deepEqual(trace.entries()[0]?.verdict, { kind: "as-expected" });
  });
});

describe("readAccessRules under Access Control Policies", () => {
  it("lists each policy, what it allows and denies, and whom it matches", async () => {
    const url = new URL("https://pod.example/alice/.acr");
    const { run } = setUp(
      turtle(`@prefix acp: <http://www.w3.org/ns/solid/acp#> .
        @prefix acl: <http://www.w3.org/ns/auth/acl#> .
        <#root> a acp:AccessControlResource ;
          acp:resource <./> ;
          acp:accessControl <#ownerAccess>, <#publicAccess> ;
          acp:memberAccessControl <#ownerAccess> .
        <#ownerAccess> acp:apply <#ownerPolicy> .
        <#publicAccess> acp:apply <#publicPolicy>, <https://pod.example/policies#shared> .
        <#ownerPolicy> acp:allow acl:Read, acl:Write, acl:Control ;
          acp:allOf <#ownerMatcher> .
        <#ownerMatcher> acp:agent <${alice}> ; acp:client acp:PublicClient .
        <#publicPolicy> acp:allow acl:Read ; acp:deny acl:Write ;
          acp:anyOf <#anyone> ; acp:noneOf <#blocked> .
        <#anyone> acp:agent acp:PublicAgent .
        <#blocked> acp:issuer <https://bad.example> ; acp:vc <https://vc.example/type> .`),
      url,
    );
    const result = await run();
    assert.ok(result.ok);
    assert.ok(result.rules.system === "acp");
    const byId = Object.fromEntries(
      result.rules.policies.map((policy) => [policy.id.replace(/^.*#/, ""), policy]),
    );
    assert.deepEqual(byId["ownerPolicy"]?.appliesTo, ["members", "resource"]);
    assert.deepEqual(byId["ownerPolicy"]?.allow.map(describeMode), ["read", "write", "control"]);
    assert.deepEqual(byId["ownerPolicy"]?.allOf, [
      {
        id: `${url.href}#ownerMatcher`,
        agents: [alice],
        clients: [`${acp}PublicClient`],
        issuers: [],
        vcs: [],
      },
    ]);
    assert.deepEqual(byId["publicPolicy"]?.appliesTo, ["resource"]);
    assert.deepEqual(byId["publicPolicy"]?.deny.map(describeMode), ["write"]);
    assert.deepEqual(byId["publicPolicy"]?.anyOf[0]?.agents.map(describeAgent), ["everyone"]);
    assert.deepEqual(byId["publicPolicy"]?.noneOf[0]?.issuers, ["https://bad.example"]);
    assert.deepEqual(byId["publicPolicy"]?.noneOf[0]?.vcs, ["https://vc.example/type"]);
    assert.equal(byId["publicPolicy"]?.definedHere, true);
    assert.equal(byId["shared"]?.definedHere, false);
  });

  it("recognises an access control resource by its controls alone", async () => {
    const { run } = setUp(
      turtle(`<> <http://www.w3.org/ns/solid/acp#memberAccessControl> <#c> .`),
      new URL("https://pod.example/alice/.acr"),
    );
    const result = await run();
    assert.ok(result.ok);
    assert.ok(result.rules.system === "acp");
    assert.deepEqual(result.rules.policies, []);
  });
});

describe("readAccessRules, whatever the system", () => {
  it("explains rules in neither form", async () => {
    const { trace, run } = setUp(
      turtle(`<> a <http://example.org/Rules> .`),
      new URL("https://pod.example/alice/.acl"),
    );
    const result = await run();
    assert.deepEqual(result, { ok: false, problem: { kind: "unrecognised" } });
    assert.equal(trace.entries()[0]?.verdict.kind, "unexpected");
  });

  it("explains a refusal: reading the rules needs Control access", async () => {
    const { run } = setUp(
      () => new Response("", { status: 403 }),
      new URL("https://pod.example/alice/.acl"),
    );
    assert.deepEqual(await run(), { ok: false, problem: { kind: "forbidden" } });
  });
});

describe("describeAgent and describeMode", () => {
  it("names well-known agents plainly, and keeps others as they are", () => {
    assert.equal(describeAgent("http://xmlns.com/foaf/0.1/Agent"), "everyone");
    assert.equal(describeAgent(`${acl}AuthenticatedAgent`), "anyone logged in");
    assert.equal(describeAgent(`${acp}OwnerAgent`), "the Pod's owner");
    assert.equal(describeAgent(alice), alice);
    assert.equal(describeMode(`${acl}Append`), "append");
  });
});
