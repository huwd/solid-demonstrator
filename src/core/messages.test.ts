import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContainerProblem } from "./container.ts";
import type { IssuerGap, IssuerProblem } from "./issuer.ts";
import type { ReturnProblem } from "./login-return.ts";
import {
  describeContainerProblem,
  describeExchangeProblem,
  describeGap,
  describeIssuerProblem,
  describeProfileGaps,
  describeProfileProblem,
  describeRegistrationProblem,
  describeReturnProblem,
  describeWebIdCheckProblem,
  describeWebIdProblem,
  type Message,
} from "./messages.ts";
import type { ProfileProblem, WebIdProfile } from "./profile.ts";
import type { RegistrationProblem } from "./registration.ts";
import type { ExchangeProblem } from "./token-exchange.ts";
import type { WebIdCheckProblem } from "./token-webid-check.ts";
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

describe("describeReturnProblem", () => {
  const cases: [ReturnProblem, RegExp, RegExp][] = [
    [{ kind: "state-mismatch" }, /doesn't match the login/, /won't use it/],
    [{ kind: "iss-missing" }, /didn't say it sent/, /has no iss/],
    [
      { kind: "iss-mismatch", stated: "https://elsewhere.example" },
      /different identity provider/,
      /You chose https:\/\/id\.example, but .+elsewhere/,
    ],
    [
      { kind: "refused", error: "access_denied", description: null },
      /You didn't allow the app/,
      /nothing was shared/,
    ],
    [
      { kind: "refused", error: "server_error", description: "Try later" },
      /returned an error/,
      /It said server_error: Try later\./,
    ],
    [
      { kind: "refused", error: "temporarily_unavailable", description: null },
      /returned an error/,
      /It said temporarily_unavailable\.$/,
    ],
    [{ kind: "no-code" }, /sent no code/, /can't go on/],
    [{ kind: "rejected", message: "duplicate state" }, /oauth4webapi/, /duplicate state/],
  ];
  for (const [problem, summary, detail] of cases) {
    it(`explains ${JSON.stringify(problem)}`, () => {
      const message = describeReturnProblem(problem, issuer);
      assertReadable(message);
      assert.match(message.summary, summary);
      assert.match(message.detail, detail);
    });
  }
});

describe("describeExchangeProblem", () => {
  const cases: [ExchangeProblem, RegExp, RegExp][] = [
    [
      { kind: "request-failed", diagnosis: { kind: "unreachable", summary: "No answer." } },
      /token endpoint couldn't be reached/,
      /^No answer\.$/,
    ],
    [
      { kind: "refused", status: 400, error: "invalid_grant", description: null },
      /wouldn't exchange the code/,
      /expired or been used/,
    ],
    [
      { kind: "refused", status: 401, error: "invalid_client", description: "Unknown" },
      /wouldn't exchange the code/,
      /It answered 401 with invalid_client: Unknown\./,
    ],
    [
      { kind: "refused", status: 400, error: "invalid_request", description: null },
      /wouldn't exchange the code/,
      /invalid_request\.$/,
    ],
    [{ kind: "not-dpop", tokenType: "bearer" }, /isn't bound/, /type bearer/],
    [{ kind: "invalid-response", message: "unexpected nonce" }, /oauth4webapi/, /unexpected nonce/],
  ];
  for (const [problem, summary, detail] of cases) {
    it(`explains ${JSON.stringify(problem)}`, () => {
      const message = describeExchangeProblem(problem, issuer);
      assertReadable(message);
      assert.match(message.summary, summary);
      assert.match(message.detail, detail);
    });
  }
});

describe("describeWebIdCheckProblem", () => {
  const webId = "https://alice.example/profile#me";
  const cases: [WebIdCheckProblem, string | null, RegExp, RegExp][] = [
    [{ kind: "no-webid" }, null, /names no WebID/, /didn't say which WebID/],
    [
      { kind: "bad-webid", problem: "not-https" },
      "http://alice.example/",
      /can't be checked/,
      /isn't a WebID/,
    ],
    [
      {
        kind: "profile",
        document: new URL("https://alice.example/profile"),
        problem: { kind: "http-error", status: 404 },
      },
      webId,
      /couldn't be read/,
      /Pod would refuse/,
    ],
    [
      { kind: "issuer-not-named", named: ["https://other.example"] },
      webId,
      /doesn't name https:\/\/id\.example/,
      /names https:\/\/other\.example, but the token is from/,
    ],
    [{ kind: "issuer-not-named", named: [] }, webId, /doesn't name/, /names no identity provider/],
  ];
  for (const [problem, named, summary, detail] of cases) {
    it(`explains ${JSON.stringify(problem)}`, () => {
      const message = describeWebIdCheckProblem(problem, issuer, named);
      assertReadable(message);
      assert.match(message.summary, summary);
      assert.match(message.detail, detail);
    });
  }
});

describe("describeRegistrationProblem", () => {
  const cases: [RegistrationProblem, RegExp, RegExp][] = [
    [
      { kind: "request-failed", diagnosis: { kind: "unreachable", summary: "No answer." } },
      /registration endpoint couldn't be reached/,
      /^No answer\.$/,
    ],
    [
      { kind: "refused", status: 400, error: "invalid_redirect_uri", description: "Not allowed" },
      /wouldn't register the app/,
      /It answered 400 with invalid_redirect_uri: Not allowed\./,
    ],
    [
      { kind: "refused", status: 400, error: "invalid_client_metadata", description: null },
      /wouldn't register/,
      /invalid_client_metadata\.$/,
    ],
    [
      { kind: "refused", status: 403, error: null, description: null },
      /wouldn't register/,
      /403, without saying why/,
    ],
    [{ kind: "no-client-id" }, /didn't give the app a client_id/, /nothing to log in with/],
  ];
  for (const [problem, summary, detail] of cases) {
    it(`explains ${JSON.stringify(problem)}`, () => {
      const message = describeRegistrationProblem(problem, issuer);
      assertReadable(message);
      assert.match(message.summary, summary);
      assert.match(message.detail, detail);
    });
  }
});

describe("describeContainerProblem", () => {
  const url = new URL("https://pod.example/alice/");
  const cases: [ContainerProblem, RegExp, RegExp][] = [
    [
      { kind: "request-failed", diagnosis: { kind: "unreachable", summary: "No answer." } },
      /couldn't be fetched/,
      /^No answer\.$/,
    ],
    [{ kind: "unauthenticated" }, /didn't accept the login/, /401.+doesn't know who's asking/],
    [{ kind: "forbidden" }, /aren't allowed/, /403.+knows who you are/],
    [{ kind: "not-found" }, /nothing at this address/, /404/],
    [{ kind: "http-error", status: 500 }, /returned an error/, /answered 500/],
    [
      { kind: "not-turtle", contentType: "text/html" },
      /listing the app can read/,
      /sent text\/html/,
    ],
    [{ kind: "not-turtle", contentType: null }, /listing the app can read/, /sent no content type/],
    [{ kind: "unparseable", message: "line 1" }, /couldn't be read/, /line 1/],
    [{ kind: "not-a-container" }, /isn't a container/, /nothing to list/],
  ];
  for (const [problem, summary, detail] of cases) {
    it(`explains ${JSON.stringify(problem)}`, () => {
      const message = describeContainerProblem(problem, url);
      assertReadable(message);
      assert.match(message.summary, summary);
      assert.match(message.detail, detail);
    });
  }
});
