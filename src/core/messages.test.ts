import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IssuerGap, IssuerProblem } from "./issuer.ts";
import {
  describeGap,
  describeIssuerProblem,
  describeProfileGaps,
  describeProfileProblem,
  describeWebIdProblem,
  type Message,
} from "./messages.ts";
import type { ProfileProblem, WebIdProfile } from "./profile.ts";
import type { WebIdProblem } from "./webid.ts";

const document = new URL("https://alice.example/profile");
const issuer = "https://id.example";
const diagnosis = { kind: "unreachable", summary: "The server didn't answer." } as const;

/** Every message must read as finished text, with nothing left unfilled. */
function assertReadable(message: Message): void {
  for (const text of [message.summary, message.detail]) {
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /undefined|null|\[object|NaN/);
  }
  assert.doesNotMatch(message.summary, /\.$/, "summaries are headings, without a full stop");
}

describe("describeWebIdProblem", () => {
  it("explains every problem with what was typed", () => {
    const problems: WebIdProblem[] = ["empty", "not-a-url", "not-https", "has-credentials"];
    const summaries = problems.map((problem) => {
      const message = describeWebIdProblem(problem);
      assertReadable(message);
      return message.summary;
    });
    assert.equal(new Set(summaries).size, problems.length, "each problem has its own message");
  });
});

describe("describeProfileProblem", () => {
  const cases: [ProfileProblem, RegExp][] = [
    [{ kind: "request-failed", diagnosis }, /didn't answer/],
    [{ kind: "http-error", status: 404 }, /404 Not Found\. Check the WebID/],
    [{ kind: "http-error", status: 503 }, /returned 503 instead/],
    [{ kind: "not-turtle", contentType: "text/html" }, /but got text\/html/],
    [{ kind: "not-turtle", contentType: null }, /no content type/],
    [{ kind: "too-large", length: 2_500_000 }, /2,500,000 characters/],
    [{ kind: "unparseable", message: "Unexpected end on line 3" }, /line 3/],
    [{ kind: "webid-not-described" }, /says nothing about the WebID/],
  ];
  for (const [problem, detail] of cases) {
    it(`explains ${JSON.stringify(problem)}`, () => {
      const message = describeProfileProblem(problem, document);
      assertReadable(message);
      assert.match(message.detail, detail);
    });
  }
});

describe("describeIssuerProblem", () => {
  const cases: [IssuerProblem, RegExp, RegExp][] = [
    [{ kind: "not-fetchable" }, /can't be contacted/, /https:\/\//],
    [{ kind: "request-failed", diagnosis }, /couldn't be reached/, /didn't answer/],
    [{ kind: "http-error", status: 404 }, /no discovery document/, /returned 404/],
    [{ kind: "too-large", length: 200_000 }, /other than a discovery document/, /JSON/],
    [{ kind: "not-json" }, /other than a discovery document/, /JSON/],
    [
      { kind: "issuer-mismatch", stated: "https://id.example/" },
      /trailing slash/,
      /calls itself https:\/\/id\.example\/\..+character for character/,
    ],
    [
      { kind: "issuer-mismatch", stated: "https://elsewhere.example" },
      /calls itself something else/,
      /says it is https:\/\/elsewhere\.example/,
    ],
    [{ kind: "issuer-mismatch", stated: undefined }, /doesn't say which issuer/, /no issuer/],
    [{ kind: "bad-endpoint", field: "token_endpoint" }, /unusable token_endpoint/, /https:\/\//],
  ];
  for (const [problem, summary, detail] of cases) {
    it(`explains ${JSON.stringify(problem)}`, () => {
      const message = describeIssuerProblem(problem, issuer);
      assertReadable(message);
      assert.match(message.summary, summary);
      assert.match(message.detail, detail);
    });
  }
});

describe("describeGap", () => {
  it("explains what each missing feature is for", () => {
    const gaps: IssuerGap[] = [
      "no-webid-scope",
      "no-pkce-s256",
      "no-dpop-es256",
      "no-way-to-identify-the-app",
    ];
    for (const gap of gaps) {
      assertReadable(describeGap(gap));
    }
  });
});

describe("describeProfileGaps", () => {
  const profile: WebIdProfile = {
    webId: new URL("https://alice.example/profile#me"),
    document,
    issuers: [issuer],
    storages: [new URL("https://pod.example/")],
    name: "Alice",
  };

  it("finds nothing missing from a profile with a provider and a Pod", () => {
    assert.deepEqual(describeProfileGaps(profile), []);
  });

  it("says when the profile names no provider or no Pod", () => {
    const gaps = describeProfileGaps({ ...profile, issuers: [], storages: [] });
    assert.deepEqual(
      gaps.map((gap) => gap.summary),
      ["The profile names no identity provider", "The profile names no Pod"],
    );
    gaps.forEach(assertReadable);
  });
});
