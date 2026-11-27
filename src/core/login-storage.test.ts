import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PendingLogin } from "./login.ts";
import {
  forgetLogins,
  forgetRegistration,
  type LoginStorage,
  loginStorageKey,
  recallRegistration,
  registrationsStorageKey,
  rememberRegistration,
  saveLogin,
  takeLogin,
} from "./login-storage.ts";

function memoryStorage(): LoginStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

const pending: PendingLogin = {
  issuer: "https://id.example",
  issParameterSupported: true,
  authorizationUrl: "https://id.example/auth?state=s",
  tokenEndpoint: "https://id.example/token",
  idTokenSigningAlgs: ["ES256"],
  clientId: "https://app.example/clientid.jsonld",
  redirectUri: "https://app.example/",
  codeVerifier: "verifier",
  state: "s",
  nonce: "n",
};

describe("saveLogin and takeLogin", () => {
  it("gives back what was saved, once", () => {
    const storage = memoryStorage();
    saveLogin(storage, { pending, entries: [] });
    assert.deepEqual(takeLogin(storage), { pending, entries: [] });
    assert.equal(storage.items.size, 0, "the secrets are removed when read");
    assert.equal(takeLogin(storage), null);
  });

  it("refuses, and removes, anything that isn't a saved login", () => {
    for (const text of [
      "not json",
      "null",
      "{}",
      JSON.stringify({ pending: null, entries: [] }),
      JSON.stringify({ pending, entries: "none" }),
      JSON.stringify({ pending: { ...pending, state: 1 }, entries: [] }),
      JSON.stringify({ pending: { ...pending, issParameterSupported: "yes" }, entries: [] }),
      JSON.stringify({ pending: { ...pending, idTokenSigningAlgs: "ES256" }, entries: [] }),
      JSON.stringify({ pending: { ...pending, idTokenSigningAlgs: [256] }, entries: [] }),
    ]) {
      const storage = memoryStorage();
      storage.setItem(loginStorageKey, text);
      assert.equal(takeLogin(storage), null, text);
      assert.equal(storage.items.size, 0, text);
    }
  });
});

describe("registrations", () => {
  const issuer = "https://id.example";
  const site = "https://app.example/";

  it("remembers a client_id per issuer and redirect address, and forgets it", () => {
    const storage = memoryStorage();
    assert.equal(recallRegistration(storage, issuer, site), null);
    rememberRegistration(storage, issuer, site, "client-a");
    rememberRegistration(storage, "https://other.example", site, "client-b");
    assert.equal(recallRegistration(storage, issuer, site), "client-a");
    assert.equal(recallRegistration(storage, "https://other.example", site), "client-b");
    assert.equal(recallRegistration(storage, issuer, "https://moved.example/"), null);

    forgetRegistration(storage, issuer, site);
    assert.equal(recallRegistration(storage, issuer, site), null);
    assert.equal(recallRegistration(storage, "https://other.example", site), "client-b");
  });

  it("ignores what was stored if it isn't a set of registrations", () => {
    for (const text of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ [JSON.stringify([issuer, site])]: 7 }),
    ]) {
      const storage = memoryStorage();
      storage.setItem(registrationsStorageKey, text);
      assert.equal(recallRegistration(storage, issuer, site), null, text);
      rememberRegistration(storage, issuer, site, "client-a");
      assert.equal(recallRegistration(storage, issuer, site), "client-a", text);
    }
  });
});

describe("forgetLogins", () => {
  it("removes the pending login and every registration", () => {
    const storage = memoryStorage();
    saveLogin(storage, { pending, entries: [] });
    rememberRegistration(storage, "https://id.example", "https://app.example/", "client-a");
    storage.setItem("someone-elses", "kept");
    forgetLogins(storage);
    assert.deepEqual([...storage.items.keys()], ["someone-elses"]);
  });
});
