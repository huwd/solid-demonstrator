import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Choice, choosableIssuers, choose, initialChoice } from "./choice.ts";
import type { DiscoveryResult, ProviderFinding } from "./discovery.ts";

type Found = Extract<DiscoveryResult, { ok: true }>;

function readable(issuer: string): ProviderFinding {
  return {
    issuer,
    result: {
      ok: true,
      configuration: {
        issuer,
        authorizationEndpoint: new URL(`${issuer}/auth`),
        tokenEndpoint: new URL(`${issuer}/token`),
        jwksUri: new URL(`${issuer}/jwks`),
        registrationEndpoint: null,
        clientIdDocuments: true,
        issParameterSupported: true,
        gaps: issuer.includes("gaps") ? ["no-pkce-s256"] : [],
      },
    },
  };
}

function unreadable(issuer: string): ProviderFinding {
  return { issuer, result: { ok: false, problem: { kind: "http-error", status: 404 } } };
}

function found(providers: ProviderFinding[], storages: string[]): Found {
  return {
    ok: true,
    profile: {
      webId: new URL("https://alice.example/profile#me"),
      document: new URL("https://alice.example/profile"),
      issuers: providers.map((finding) => finding.issuer),
      storages: storages.map((storage) => new URL(storage)),
      name: null,
    },
    providers,
  };
}

const none: Choice = { issuer: null, storage: null };

describe("choosableIssuers", () => {
  it("offers every provider that could be read, including those with gaps", () => {
    const result = found(
      [
        readable("https://one.example"),
        unreadable("https://gone.example"),
        readable("https://gaps.example"),
      ],
      [],
    );
    assert.deepEqual(choosableIssuers(result), ["https://one.example", "https://gaps.example"]);
  });
});

describe("initialChoice", () => {
  it("chooses the only provider and the only Pod", () => {
    const result = found(
      [readable("https://one.example"), unreadable("https://gone.example")],
      ["https://pod.example/"],
    );
    assert.deepEqual(initialChoice(result), {
      issuer: "https://one.example",
      storage: "https://pod.example/",
    });
  });

  it("leaves the choice to the person when there are several, or none", () => {
    assert.deepEqual(
      initialChoice(
        found(
          [readable("https://one.example"), readable("https://two.example")],
          ["https://pod-one.example/", "https://pod-two.example/"],
        ),
      ),
      none,
    );
    assert.deepEqual(initialChoice(found([unreadable("https://gone.example")], [])), none);
  });
});

describe("choose", () => {
  const result = found(
    [
      readable("https://one.example"),
      readable("https://two.example"),
      unreadable("https://gone.example"),
    ],
    ["https://pod-one.example/", "https://pod-two.example/"],
  );

  it("records a choice from the profile's own options", () => {
    const chosen = choose(none, result, { issuer: "https://two.example" });
    assert.deepEqual(chosen, { issuer: "https://two.example", storage: null });
    assert.deepEqual(choose(chosen, result, { storage: "https://pod-one.example/" }), {
      issuer: "https://two.example",
      storage: "https://pod-one.example/",
    });
  });

  it("lets the person switch Pod later", () => {
    const first = choose(none, result, { storage: "https://pod-one.example/" });
    assert.equal(
      choose(first, result, { storage: "https://pod-two.example/" }).storage,
      "https://pod-two.example/",
    );
  });

  it("ignores anything the profile didn't offer, or that can't be used", () => {
    const current: Choice = { issuer: "https://one.example", storage: "https://pod-one.example/" };
    for (const change of [
      { issuer: "https://elsewhere.example" },
      { issuer: "https://gone.example" },
      { storage: "https://elsewhere.example/" },
      {},
    ]) {
      assert.deepEqual(choose(current, result, change), current, JSON.stringify(change));
    }
  });
});
