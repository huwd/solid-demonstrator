import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientIdDocument, clientIdDocumentPath } from "./client-id.ts";

describe("clientIdDocument", () => {
  const document = clientIdDocument(new URL("https://example.org/demonstrator/"));

  it("uses its own address, beside the app, as the client_id", () => {
    assert.equal(clientIdDocumentPath, "clientid.jsonld");
    assert.equal(document.client_id, "https://example.org/demonstrator/clientid.jsonld");
  });

  it("sends the person back to the app's own start page", () => {
    assert.deepEqual(document.redirect_uris, ["https://example.org/demonstrator/"]);
    assert.deepEqual(document.post_logout_redirect_uris, ["https://example.org/demonstrator/"]);
    assert.equal(document.client_uri, "https://example.org/demonstrator/");
  });

  it("describes a public client that asks for a WebID, without refresh tokens", () => {
    assert.deepEqual(document["@context"], ["https://www.w3.org/ns/solid/oidc-context.jsonld"]);
    assert.equal(document.scope, "openid webid");
    assert.doesNotMatch(document.scope, /offline_access/);
    assert.equal(document.token_endpoint_auth_method, "none");
    assert.deepEqual(document.grant_types, ["authorization_code"]);
    assert.deepEqual(document.response_types, ["code"]);
  });

  it("works for an app served from the root of its origin", () => {
    const atRoot = clientIdDocument(new URL("https://demo.example/"));
    assert.equal(atRoot.client_id, "https://demo.example/clientid.jsonld");
    assert.deepEqual(atRoot.redirect_uris, ["https://demo.example/"]);
  });
});
