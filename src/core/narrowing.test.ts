import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Parser } from "n3";
import { acpExample, hasStableClientId, wacExample } from "./narrowing.ts";

const subject = {
  webId: "https://alice.example/profile#me",
  clientId: "https://app.example/clientid.jsonld",
  origin: "https://app.example",
  folder: new URL("https://pod.example/alice/solid-demonstrator/"),
};

const parse = (turtle: string) =>
  new Parser({ baseIRI: "https://pod.example/alice/solid-demonstrator/.acr" }).parse(turtle);

describe("acpExample", () => {
  it("requires both this person and this app, for reading and writing", () => {
    const example = acpExample(subject);
    assert.ok(example !== null);
    const quads = parse(example);
    const values = (predicate: string) =>
      quads
        .filter((quad) => quad.predicate.value.endsWith(predicate))
        .map((quad) => quad.object.value);
    assert.deepEqual(values("#agent"), [subject.webId]);
    assert.deepEqual(values("#client"), [subject.clientId]);
    assert.deepEqual(values("#allow"), [
      "http://www.w3.org/ns/auth/acl#Read",
      "http://www.w3.org/ns/auth/acl#Write",
    ]);
  });

  it("gives no example when the app was registered, since its identifier changes", () => {
    assert.equal(acpExample({ ...subject, clientId: "f6c2d1" }), null);
    assert.equal(acpExample({ ...subject, clientId: null }), null);
  });
});

describe("wacExample", () => {
  it("limits this person to this app's origin, for the folder and what it holds", () => {
    const quads = parse(wacExample(subject));
    const values = (predicate: string) =>
      quads
        .filter((quad) => quad.predicate.value.endsWith(predicate))
        .map((quad) => quad.object.value);
    assert.deepEqual(values("#origin"), [subject.origin]);
    assert.deepEqual(values("#accessTo"), [subject.folder.href]);
    assert.deepEqual(values("#default"), [subject.folder.href]);
  });
});

describe("hasStableClientId", () => {
  it("accepts only an https URL", () => {
    assert.equal(hasStableClientId("https://app.example/clientid.jsonld"), true);
    assert.equal(hasStableClientId("http://localhost/clientid.jsonld"), false);
  });
});
