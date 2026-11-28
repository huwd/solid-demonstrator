/**
 * The scripted journey that introduces Solid (decision 0020): Alice, on
 * fictional servers, from her WebID to a refusal by her Pod.
 *
 * The exchanges are examples written from the specifications. They hold
 * fake secrets, such as a login code and an access token, and are built
 * through the same redaction as a live session's, so the introduction can
 * never show what a live session would hide. They are never added to the
 * trace: `exampleEntries` shapes them like trace entries only so the same
 * views can draw them.
 *
 * Its steps match, in order, the live flow's against the fictional servers.
 * A browser test checks that, so a change to the steps fails until the
 * script follows it.
 */

import { redactCapabilityUrl, redactMessage, redactRequest, redactResponse } from "./redaction.ts";
import type {
  Header,
  Party,
  Provenance,
  RecordedBody,
  RecordedRequest,
  RecordedResponse,
  TraceEntry,
  Verdict,
} from "./trace.ts";

export interface ScriptStep {
  readonly step: string;
  readonly from: Party;
  readonly to: Party;
  readonly provenance: Provenance;
  readonly purpose: string;
  readonly explanation: string;
  readonly specification: string;
  readonly request?: RecordedRequest;
  readonly response?: RecordedResponse;
  readonly message?: RecordedBody;
  readonly verdict?: Verdict;
}

export interface ScriptChapter {
  readonly title: string;
  /** What happens in the chapter, for someone new to Solid. */
  readonly narration: string;
  /** What to look for in the pictures. */
  readonly watchFor: string;
  readonly steps: readonly ScriptStep[];
}

const profile = "https://alice.example/profile/card";
const webId = `${profile}#me`;
const broker = "https://broker.example";
const pod = "https://pod.example/alice/";
const scratch = `${pod}solid-demonstrator/`;
const app = "https://demonstrator.example/";
const clientId = `${app}clientid.jsonld`;
const subscriptionService = "https://pod.example/.notifications/WebSocketChannel2023/";
const channel = "9b2e4f1c-7d3a-4c8e-b6f0-2a5d8e1c4b7f";

/** A JSON Web Token's shape, with a fake signature. Redaction removes it and shows its claims. */
function fakeToken(header: Record<string, unknown>, claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode(header)}.${encode(claims)}.ZmFrZS1zaWduYXR1cmUtZm9yLWFuLWV4YW1wbGU`;
}

const key = {
  kty: "EC",
  crv: "P-256",
  x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
};
const issuedAt = 1_798_794_000;

const proof = (method: string, url: string) =>
  fakeToken(
    { typ: "dpop+jwt", alg: "ES256", jwk: key },
    { htm: method, htu: url, iat: issuedAt, jti: "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b" },
  );

const accessToken = fakeToken(
  { typ: "at+jwt", alg: "ES256", kid: "broker-key-1" },
  {
    iss: broker,
    sub: webId,
    webid: webId,
    aud: "solid",
    client_id: clientId,
    iat: issuedAt,
    exp: issuedAt + 300,
    jti: "a7c3e9f1-2b4d-4f6a-8c0e-1d3f5a7b9c2e",
    cnf: { jkt: "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I" },
  },
);

const idToken = fakeToken(
  { typ: "JWT", alg: "ES256", kid: "broker-key-1" },
  {
    iss: broker,
    sub: webId,
    webid: webId,
    aud: clientId,
    nonce: "n-4f8a2c6e9b1d3f5a7c9e",
    iat: issuedAt,
    exp: issuedAt + 3600,
  },
);

const code = "SplxlOBeZQQYbYS6WxSbIA-example-login-code";
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const state = "af0ifjsldkj-example-state-value";
const nonce = "n-4f8a2c6e9b1d3f5a7c9e";

/**
 * The script's fake secrets, so a test can check none is ever shown. The
 * nonce isn't one: a live session shows it in the ID token's claims, once
 * it's spent.
 */
export const exampleSecrets: readonly string[] = [
  accessToken,
  idToken,
  code,
  verifier,
  state,
  channel,
];

const asExpected: Verdict = { kind: "as-expected" };

function request(
  method: string,
  url: string,
  headers: readonly Header[] = [],
  body: RecordedBody = { kind: "none" },
): RecordedRequest {
  return { method, url, headers, body };
}

function response(
  status: number,
  statusText: string,
  headers: readonly Header[] = [],
  body: RecordedBody = { kind: "none" },
): RecordedResponse {
  return { status, statusText, headers, body };
}

/** A request to the Pod, with the access token and a fresh proof. */
function toPod(method: string, url: string, headers: readonly Header[] = [], body?: RecordedBody) {
  return request(
    method,
    url,
    [["authorization", `DPoP ${accessToken}`], ["dpop", proof(method, url)], ...headers],
    body,
  );
}

const turtle = (text: string): RecordedBody => ({ kind: "text", text, truncated: false });

const profileResponse = response(
  200,
  "OK",
  [["content-type", "text/turtle"]],
  turtle(`@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .

<#me> solid:oidcIssuer <${broker}> ;
  pim:storage <${pod}> .`),
);

const brokerConfiguration = response(200, "OK", [["content-type", "application/json"]], {
  kind: "json",
  value: {
    issuer: broker,
    authorization_endpoint: `${broker}/authorize`,
    token_endpoint: `${broker}/token`,
    jwks_uri: `${broker}/jwks`,
    scopes_supported: ["openid", "webid"],
    code_challenge_methods_supported: ["S256"],
    dpop_signing_alg_values_supported: ["ES256"],
    client_id_metadata_document_supported: true,
  },
});

const podHeaders = (etag: string): Header[] => [
  ["content-type", "text/turtle"],
  ["etag", etag],
  ["wac-allow", 'user="read write append control", public=""'],
  [
    "link",
    '<https://pod.example/.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription"',
  ],
];

const container = (items: readonly string[]) =>
  turtle(
    `<> a <http://www.w3.org/ns/ldp#BasicContainer>${
      items.length === 0
        ? ""
        : ` ;\n  <http://www.w3.org/ns/ldp#contains> ${items.map((item) => `<${item}>`).join(", ")}`
    } .`,
  );

const readingPod = "https://solidproject.org/TR/protocol#reading-resources";
const writingPod = "https://solidproject.org/TR/protocol#writing-resources";
const websocket = "https://solidproject.org/TR/websocket-channel-2023";

export const aliceScript: readonly ScriptChapter[] = [
  {
    title: "Who's involved",
    narration:
      "Alice wants to use an app with the data in her Pod. Four parties take part: the app, Alice's profile, the service she logs in with, and her Pod. The app starts out knowing one thing: Alice's WebID, a web address that stands for her.",
    watchFor: "Each party appears on the map as the app finds it.",
    steps: [],
  },
  {
    title: "Finding Alice's servers",
    narration:
      "The app opens the page at Alice's WebID: her profile. It names the service that logs her in, called her identity provider, and says where her Pod is. The app then asks the identity provider how logging in works there.",
    watchFor: "The WebID is all the app needs to know in advance. It finds everything else.",
    steps: [
      {
        step: "fetchWebIdProfile",
        from: "app",
        to: "webid-profile",
        provenance: "seen",
        purpose: "Open Alice's profile, to find her identity provider and her Pod.",
        explanation:
          "A WebID is a web address. Opening it, without the part after #, gives Alice's profile. It's written in Turtle, a format for data on the web. Two lines matter here: solid:oidcIssuer names who may log her in, and pim:storage names her Pod.",
        specification: "https://solidproject.org/TR/protocol#webid",
        request: request("GET", profile, [["accept", "text/turtle"]]),
        response: profileResponse,
      },
      {
        step: "discoverIssuer",
        from: "app",
        to: "identity-provider",
        provenance: "seen",
        purpose: "Ask Alice's identity provider how to log in with it.",
        explanation:
          "Every identity provider describes itself at a fixed address. The description says where to send people to log in, where the app collects its pass afterwards, and which safety features the provider supports. Two of those, PKCE and DPoP, come up in the next chapter.",
        specification: "https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig",
        request: request("GET", `${broker}/.well-known/openid-configuration`),
        response: brokerConfiguration,
      },
    ],
  },
  {
    title: "Logging in",
    narration:
      "The app sends Alice to her identity provider to log in, so the app never sees her password. She comes back with a one-time code. The app swaps it for a pass that says who she is, called an access token. The pass only works with a stamp that this browser tab alone can make, so a stolen pass is useless.",
    watchFor:
      "Dashed lines are trips the browser made out of the app's sight, so the app pieces them together. The loop is the app checking things for itself.",
    steps: [
      {
        step: "redirectToIdentityProvider",
        from: "app",
        to: "identity-provider",
        provenance: "reconstructed",
        purpose: "Send Alice to her identity provider to log in.",
        explanation:
          "The browser leaves the app for the identity provider's own page. The address carries a PKCE challenge: a puzzle only this app can answer, so only this app can use the code that comes back. It also carries a state value, which the app checks when Alice returns, to be sure she's coming back from this login.",
        specification: "https://solidproject.org/TR/oidc#authorization-code-pkce-flow",
        request: request(
          "GET",
          `${broker}/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(app)}&scope=openid%20webid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=${state}&nonce=${nonce}`,
        ),
      },
      {
        step: "loginAtIdentityProvider",
        from: "identity-provider",
        to: "identity-provider",
        provenance: "explained",
        purpose: "Alice logs in, and agrees to let the app act for her.",
        explanation:
          "This happens on the identity provider's own pages, out of the app's sight. The provider reads the app's Client ID Document, a short public description of the app, to show Alice who is asking. Agreeing lets the app act for Alice. It doesn't open her Pod by itself: the Pod's own rules decide that.",
        specification: "https://openid.net/specs/openid-connect-core-1_0.html#Consent",
      },
      {
        step: "returnFromIdentityProvider",
        from: "identity-provider",
        to: "app",
        provenance: "reconstructed",
        purpose: "Alice comes back to the app with a one-time code.",
        explanation:
          "The identity provider sends the browser back to the app. The address holds the code, the state value the app sent, and the provider's own address. The app checks them, to be sure the answer is to its own request and from the provider it chose.",
        specification: "https://www.rfc-editor.org/rfc/rfc9207.html",
        request: request(
          "GET",
          `${app}?code=${code}&state=${state}&iss=${encodeURIComponent(broker)}`,
        ),
      },
      {
        step: "exchangeCode",
        from: "app",
        to: "identity-provider",
        provenance: "seen",
        purpose: "Swap the one-time code for a pass that says who Alice is.",
        explanation:
          "The app sends the code with the answer to its PKCE puzzle, proving it started this login. It also sends a DPoP proof: a stamp made with a key that never leaves this browser tab. The identity provider ties the pass, the access token, to that key, so the pass is useless without it. An ID token comes back too, telling the app who logged in.",
        specification: "https://solidproject.org/TR/oidc#tokens",
        request: request(
          "POST",
          `${broker}/token`,
          [
            ["content-type", "application/x-www-form-urlencoded"],
            ["dpop", proof("POST", `${broker}/token`)],
          ],
          {
            kind: "form",
            fields: [
              ["grant_type", "authorization_code"],
              ["code", code],
              ["redirect_uri", app],
              ["client_id", clientId],
              ["code_verifier", verifier],
            ],
          },
        ),
        response: response(200, "OK", [["content-type", "application/json"]], {
          kind: "json",
          value: {
            access_token: accessToken,
            id_token: idToken,
            token_type: "DPoP",
            expires_in: 300,
          },
        }),
      },
      {
        step: "checkTokenWebId",
        from: "app",
        to: "webid-profile",
        provenance: "seen",
        purpose: "Open the profile the pass names, to check it trusts this identity provider.",
        explanation:
          "Anyone can run an identity provider. So a Pod checks that the person's own profile names the identity provider that issued their pass. Otherwise any provider could issue passes naming anyone. The app makes the same check, so you can see it.",
        specification: "https://solidproject.org/TR/oidc",
        request: request("GET", profile, [["accept", "text/turtle"]]),
        response: profileResponse,
      },
      {
        step: "checkTokenWebId",
        from: "app",
        to: "app",
        provenance: "repeated",
        purpose:
          "Check Alice's profile names the identity provider that issued the pass, as the Pod will.",
        explanation:
          "The profile names https://broker.example as Alice's identity provider, so a Pod will accept passes from it that name her WebID.",
        specification: "https://solidproject.org/TR/oidc",
        verdict: asExpected,
      },
    ],
  },
  {
    title: "Reading Alice's Pod",
    narration:
      "The app now reads Alice's Pod as her. Every request carries the pass and a fresh stamp. The Pod checks both, then its own rules on who may open what, before it answers. The app repeats the checks it can, so you can see what the Pod sees.",
    watchFor:
      "The Pod and its notification service share a shaded box: they run at the same address.",
    steps: [
      {
        step: "readContainer",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Read the top folder of Alice's Pod, as Alice.",
        explanation:
          "Reading a folder lists what's in it. Solid calls folders containers. Headers are notes that travel with the answer: WAC-Allow says what Alice may do here, and Link points to the Pod's description of itself.",
        specification: readingPod,
        request: toPod("GET", pod, [["accept", "text/turtle"]]),
        response: response(
          200,
          "OK",
          podHeaders('"r1"'),
          container([`${pod}profile/`, `${pod}private/`]),
        ),
      },
      {
        step: "checkPodTrust",
        from: "app",
        to: "identity-provider",
        provenance: "seen",
        purpose:
          "Read the identity provider's description, to find its public keys, as the Pod will.",
        explanation:
          "To check a pass is genuine, a Pod needs the keys of the identity provider that signed it. The provider's description says where they are.",
        specification: "https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig",
        request: request("GET", `${broker}/.well-known/openid-configuration`),
        response: brokerConfiguration,
      },
      {
        step: "readStorageDescription",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose:
          "Read the Pod's description of itself, to find what it offers, such as notifications.",
        explanation:
          "A Pod describes itself at the address its Link header names. This one offers notifications over a WebSocket: a connection that stays open, so the Pod can send news as it happens.",
        specification: "https://solidproject.org/TR/protocol#storage-description",
        request: toPod("GET", "https://pod.example/.well-known/solid", [["accept", "text/turtle"]]),
        response: response(
          200,
          "OK",
          [["content-type", "text/turtle"]],
          turtle(`@prefix notify: <http://www.w3.org/ns/solid/notifications#> .

<> notify:subscription <${subscriptionService}> .
<${subscriptionService}> notify:channelType notify:WebSocketChannel2023 .`),
        ),
      },
      {
        step: "checkPodTrust",
        from: "app",
        to: "identity-provider",
        provenance: "seen",
        purpose: "Fetch the identity provider's public keys, to check the pass is genuine.",
        explanation:
          "The identity provider signs each pass with a private key, and publishes the matching public key. Anyone can use it to check a signature, but not to make one.",
        specification: "https://www.rfc-editor.org/rfc/rfc7517#section-5",
        request: request("GET", `${broker}/jwks`),
        response: response(200, "OK", [["content-type", "application/json"]], {
          kind: "json",
          value: { keys: [{ ...key, kid: "broker-key-1", use: "sig", alg: "ES256" }] },
        }),
      },
      {
        step: "checkPodTrust",
        from: "app",
        to: "app",
        provenance: "repeated",
        purpose: "Check the pass and a stamp, as the Pod will.",
        explanation:
          "The pass was signed by Alice's identity provider, is meant for Solid, and hasn't expired. The stamp names this request, is fresh, and was made with the key the pass is tied to. Only the Pod applies its rules on who may open what: those are its own.",
        specification: "https://solidproject.org/TR/oidc",
        verdict: asExpected,
      },
    ],
  },
  {
    title: "Writing to Alice's Pod",
    narration:
      "The app writes only in a folder of its own, unless Alice chooses otherwise. Each write tells the Pod what it expects to find, so it can never overwrite someone else's change by mistake.",
    watchFor:
      "Writing goes the same way as reading: from the app to the Pod, with the pass and a stamp.",
    steps: [
      {
        step: "createResource",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Create the app's own folder, unless it's already there.",
        explanation:
          "Writing to an address that ends in a slash makes a folder there. The If-None-Match: * header asks the Pod to refuse if anything is already at that address.",
        specification: writingPod,
        request: toPod("PUT", scratch, [
          ["content-type", "text/turtle"],
          ["if-none-match", "*"],
        ]),
        response: response(201, "Created", [["etag", '"s1"']]),
      },
      {
        step: "readContainer",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Read the app's folder, to list what's in it.",
        explanation: "The new folder is empty.",
        specification: readingPod,
        request: toPod("GET", scratch, [["accept", "text/turtle"]]),
        response: response(200, "OK", podHeaders('"s1"'), container([])),
      },
    ],
  },
  {
    title: "Watching for changes",
    narration:
      "The app asks to be told about changes to its folder. The Pod's notification service gives it an address to listen at, then sends a message for each change, whoever made it.",
    watchFor: "The notification travels from the service back to the app.",
    steps: [
      {
        step: "subscribe",
        from: "app",
        to: "notification-service",
        provenance: "seen",
        purpose: `Ask to be told about changes to ${scratch}.`,
        explanation:
          "The Pod's description named this notification service. The service checks Alice may read the folder, then answers with an address to listen at. Anyone with that address can listen, so it's shortened here.",
        specification: websocket,
        request: toPod("POST", subscriptionService, [["content-type", "application/ld+json"]], {
          kind: "json",
          value: {
            "@context": ["https://www.w3.org/ns/solid/notification/v1"],
            type: "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
            topic: scratch,
          },
        }),
        response: response(200, "OK", [["content-type", "application/ld+json"]], {
          kind: "json",
          value: {
            "@context": ["https://www.w3.org/ns/solid/notification/v1"],
            id: `${subscriptionService}${channel}`,
            type: "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
            topic: scratch,
            receiveFrom: `wss://pod.example/.notifications/ws/${channel}`,
          },
        }),
      },
      {
        step: "listen",
        from: "app",
        to: "notification-service",
        provenance: "seen",
        purpose: "Connect to the address the service gave, to receive notifications.",
        explanation:
          "The connection is a WebSocket, which stays open. No pass is sent: holding the address is what lets the app listen.",
        specification: websocket,
        request: request(
          "GET",
          redactCapabilityUrl(`wss://pod.example/.notifications/ws/${channel}`),
          [["upgrade", "websocket"]],
        ),
      },
      {
        step: "notification",
        from: "notification-service",
        to: "app",
        provenance: "seen",
        purpose: `A notification: ${scratch}note.txt was added.`,
        explanation:
          "The service tells everyone watching the folder that something was added to it, here even before the Pod's answer to the write reaches the app. It would do the same for a change from another app.",
        specification: websocket,
        message: {
          kind: "json",
          value: {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://www.w3.org/ns/solid/notification/v1",
            ],
            id: "urn:uuid:3c5e7a9b-1d2f-4e6a-8b0c-2d4f6a8b0c1e",
            type: "Add",
            object: `${scratch}note.txt`,
            target: scratch,
            state: '"n1"',
            published: "2027-01-01T09:00:19Z",
          },
        },
      },
      {
        step: "createResource",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Create a note in the app's folder.",
        explanation:
          "The Pod answers with the version of the note, called its ETag. The app sends it back with any later change, so the change only happens if nobody else has changed the note since.",
        specification: writingPod,
        request: toPod(
          "PUT",
          `${scratch}note.txt`,
          [
            ["content-type", "text/plain"],
            ["if-none-match", "*"],
          ],
          turtle("Hello from the demonstrator."),
        ),
        response: response(201, "Created", [["etag", '"n1"']]),
      },
      {
        step: "readContainer",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Read the app's folder again, to list the new note.",
        explanation: "The folder now holds the note.",
        specification: readingPod,
        request: toPod("GET", scratch, [["accept", "text/turtle"]]),
        response: response(200, "OK", podHeaders('"s2"'), container([`${scratch}note.txt`])),
      },
    ],
  },
  {
    title: "When the Pod says no",
    narration:
      "Alice has a private folder. Her Pod uses Access Control Policies: rules that can name the apps allowed in, as well as the people. This folder's rules let in only one other app. So although this app acts for Alice, the Pod turns it away.",
    watchFor: "The refused request is marked in red on the map and in the timeline.",
    steps: [
      {
        step: "readContainer",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Read the top folder of Alice's Pod again.",
        explanation: "It lists private/ among what's in it.",
        specification: readingPod,
        request: toPod("GET", pod, [["accept", "text/turtle"]]),
        response: response(
          200,
          "OK",
          podHeaders('"r1"'),
          container([`${pod}profile/`, `${pod}private/`, scratch]),
        ),
      },
      {
        step: "readContainer",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Try to read the private folder, as Alice, through this app.",
        explanation:
          "The pass and stamp are as good as before. But the folder's rules list the apps that may read it, and this app isn't one. The Pod answers 403 Forbidden: it knows who is asking, and won't let this app in.",
        specification: "https://solidproject.org/TR/protocol#authorization",
        request: toPod("GET", `${pod}private/`, [["accept", "text/turtle"]]),
        response: response(403, "Forbidden"),
        verdict: {
          kind: "unexpected",
          expected: "200 OK",
          actual: "403: the Pod's rules don't let this app read it",
        },
      },
    ],
  },
];

/** Every step's name, in order, for checking the script against the live flow. */
export function scriptSteps(script: readonly ScriptChapter[]): readonly string[] {
  return script.flatMap((chapter) => chapter.steps.map((step) => step.step));
}

/**
 * The script's steps, redacted as a live session's would be, and shaped like
 * trace entries for the views. They are never added to a trace.
 */
export function exampleEntries(script: readonly ScriptChapter[]): readonly TraceEntry[] {
  return script
    .flatMap((chapter) => chapter.steps)
    .map((step, index) => ({
      ...redactStep(step),
      id: index + 1,
      at: new Date(Date.UTC(2027, 0, 1, 9, 0, index + 1)).toISOString(),
      verdict: step.verdict ?? asExpected,
    }));
}

/** A step with its exchange redacted, and the tokens redaction found. */
function redactStep(step: ScriptStep) {
  const { request, response, message, ...rest } = step;
  const redacted = {
    request: request === undefined ? undefined : redactRequest(request),
    response: response === undefined ? undefined : redactResponse(response),
    message: message === undefined ? undefined : redactMessage(message),
  };
  return {
    ...rest,
    decodedTokens: Object.values(redacted).flatMap((part) => part?.decodedTokens ?? []),
    ...(redacted.request === undefined ? {} : { request: redacted.request.value }),
    ...(redacted.response === undefined ? {} : { response: redacted.response.value }),
    ...(redacted.message === undefined ? {} : { message: redacted.message.value }),
  };
}

/** The chapter each example entry belongs to, by its position in the script. */
export function chapterOfEntry(script: readonly ScriptChapter[], id: number): number {
  let seen = 0;
  for (const [index, chapter] of script.entries()) {
    seen += chapter.steps.length;
    if (id <= seen) {
      return index;
    }
  }
  return script.length - 1;
}
