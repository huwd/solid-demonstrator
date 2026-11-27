import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLinkHeader, readSolidLinks } from "./link-header.ts";

const base = new URL("https://pod.example/alice/");

describe("parseLinkHeader", () => {
  it("reads each link, resolving targets and lower-casing registered types", () => {
    const links = parseLinkHeader(
      '<.acl>; rel="acl", <http://www.w3.org/ns/pim/space#Storage>; rel=type, <https://x.example/a,b>; title="a; b, c"; rel="Next http://example.org/Rel"',
      base,
    );
    assert.deepEqual(
      links.map((link) => [link.target.href, link.rels]),
      [
        ["https://pod.example/alice/.acl", ["acl"]],
        ["http://www.w3.org/ns/pim/space#Storage", ["type"]],
        ["https://x.example/a,b", ["next", "http://example.org/Rel"]],
      ],
    );
  });

  it("skips links without a relation, or with a target it can't read", () => {
    assert.deepEqual(parseLinkHeader('<a>; title="no rel", <http://[>; rel="acl"', base), []);
    assert.deepEqual(parseLinkHeader(null, base), []);
  });
});

describe("readSolidLinks", () => {
  it("finds a storage root, its description and its access rules", () => {
    assert.deepEqual(
      readSolidLinks(
        '<http://www.w3.org/ns/pim/space#Storage>; rel="type", </.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription", <alice/.acr>; rel="acl"',
        new URL("https://pod.example/"),
      ),
      {
        isStorage: true,
        storageDescription: new URL("https://pod.example/.well-known/solid"),
        accessRules: new URL("https://pod.example/alice/.acr"),
      },
    );
  });

  it("finds nothing in a header that says nothing", () => {
    assert.deepEqual(readSolidLinks('<http://www.w3.org/ns/ldp#Container>; rel="type"', base), {
      isStorage: false,
      storageDescription: null,
      accessRules: null,
    });
  });
});
