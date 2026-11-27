import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PendingLogin } from "./login.ts";
import { type LoginStorage, loginStorageKey, saveLogin, takeLogin } from "./login-storage.ts";

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
