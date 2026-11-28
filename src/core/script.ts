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
      "Alice wants to use an app with her data. In Solid, her data doesn't live in the app: it lives in her Pod, a store on the web that she chooses. The app starts out knowing only her WebID, an address that identifies her.",
    watchFor: "Watch each party appear on the map as the app finds it.",
    steps: [],
  },
  {
    title: "Finding Alice's servers",
    narration:
      "The app reads Alice's WebID profile. It names the identity provider she logs in with, and the Pod that holds her data. The app then asks the provider how to log in with it.",
    watchFor: "The profile is the only thing the app needs to know in advance.",
    steps: [
      {
        step: "fetchWebIdProfile",
        from: "app",
        to: "webid-profile",
        provenance: "seen",
        purpose: "Fetch Alice's WebID profile, to find her identity provider and Pod.",
        explanation:
          "A WebID is a URL. Fetching it, without the part after #, gives Alice's profile: a small Turtle document saying who she trusts to log her in (solid:oidcIssuer) and where her data is (pim:storage).",
        specification: "https://solidproject.org/TR/protocol#webid",
        request: request("GET", profile, [["accept", "text/turtle"]]),
        response: profileResponse,
      },
      {
        step: "discoverIssuer",
        from: "app",
        to: "identity-provider",
        provenance: "seen",
        purpose: "Ask the identity provider how to log in with it.",
        explanation:
          "Every OpenID provider publishes its configuration at a well-known address: where to send people to log in, where to swap a code for tokens, and which features it supports, such as PKCE and DPoP.",
        specification: "https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig",
        request: request("GET", `${broker}/.well-known/openid-configuration`),
        response: brokerConfiguration,
      },
    ],
  },
  {
    title: "Logging in",
    narration:
      "The app sends Alice to her own identity provider to log in, so the app never sees her password. She comes back with a one-time code, which the app swaps for tokens. The access token names her WebID, and works only with proofs from a key this browser tab holds.",
    watchFor:
      "Dashed lines are reconstructed: the browser made those trips, so the app can only rebuild them. The loop is the app checking the token itself.",
    steps: [
      {
        step: "redirectToIdentityProvider",
        from: "app",
        to: "identity-provider",
        provenance: "reconstructed",
        purpose: "Send Alice to her identity provider's login page.",
        explanation:
          "The browser leaves the app for the provider's own page. The request carries a PKCE challenge, so only this app can use the code that comes back, and a state value the app checks when Alice returns.",
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
          "This happens on the provider's pages, out of the app's sight. The provider fetches the app's Client ID Document to show Alice who is asking. Agreeing lets the app log in as Alice: it grants no access to her data by itself.",
        specification: "https://openid.net/specs/openid-connect-core-1_0.html#Consent",
      },
      {
        step: "returnFromIdentityProvider",
        from: "identity-provider",
        to: "app",
        provenance: "reconstructed",
        purpose: "Alice comes back to the app with a one-time code.",
        explanation:
          "The provider sends the browser back to the app with the code, the state the app sent, and its own name, so the app can check the answer is to its own request and from the provider it chose.",
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
        purpose: "Swap the one-time code for tokens, bound to this tab's key.",
        explanation:
          "The app sends the code with the PKCE verifier, proving it started the login, and a DPoP proof made with a key that never leaves this tab. The provider binds the access token to that key, so a stolen token is useless without it.",
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
        purpose: "Fetch the WebID profile the token names, to check it trusts this provider.",
        explanation:
          "A Pod checks that the profile of the WebID in the token names the token's issuer. Otherwise any provider could issue tokens naming anyone. The app fetches the profile to make the same check.",
        specification: "https://solidproject.org/TR/oidc",
        request: request("GET", profile, [["accept", "text/turtle"]]),
        response: profileResponse,
      },
      {
        step: "checkTokenWebId",
        from: "app",
        to: "app",
        provenance: "repeated",
        purpose: "Check Alice's profile names the token's issuer, as the Pod will.",
        explanation:
          "The profile names https://broker.example as an identity provider for Alice, so a Pod will accept tokens from it that name her WebID.",
        specification: "https://solidproject.org/TR/oidc",
        verdict: asExpected,
      },
    ],
  },
  {
    title: "Reading Alice's Pod",
    narration:
      "The app reads Alice's Pod as her. Every request carries the access token and a fresh proof. The Pod checks both, then its access rules, before it answers. The app repeats the checks it can, so you can see what the Pod sees.",
    watchFor: "The Pod and the notification service share a box: they're one service.",
    steps: [
      {
        step: "readContainer",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Read the top folder of Alice's Pod, as Alice.",
        explanation:
          "Folders in a Pod are containers. Reading one lists what it holds. The WAC-Allow header says what Alice may do here, and the Link header points to the storage description.",
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
          "Fetch the identity provider's configuration, to find its public keys, as the Pod will.",
        explanation:
          "To check the token's signature, a Pod needs the keys of the provider that signed it. The configuration says where they are.",
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
          "Read the storage description, to find what the Pod offers, such as notifications.",
        explanation:
          "A Pod describes itself at the address its Link header names. This one offers notifications over a WebSocket.",
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
        purpose: "Fetch the identity provider's public keys, to check the token's signature.",
        explanation:
          "The provider publishes the public halves of the keys it signs tokens with. Anyone can check a signature with them.",
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
        purpose: "Check the access token and a DPoP proof as the Pod will.",
        explanation:
          "The token is signed by Alice's provider, is for Solid, and hasn't expired. The proof names this request, is fresh, and was signed with the key the token is bound to. Only the Pod applies its access rules: those are its own.",
        specification: "https://solidproject.org/TR/oidc",
        verdict: asExpected,
      },
    ],
  },
  {
    title: "Writing to Alice's Pod",
    narration:
      "The app writes only in a folder of its own, unless Alice chooses otherwise. Each write says which version it expects, so it can never overwrite someone else's change.",
    watchFor: "If-None-Match: * means create this only if nothing is there yet.",
    steps: [
      {
        step: "createResource",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Create the app's scratch folder, unless it's already there.",
        explanation:
          "A PUT to an address ending in a slash makes a folder there. If-None-Match: * asks the Pod to refuse if anything is already at that address.",
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
        purpose: "Read the scratch folder, to list what it holds.",
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
      "The app subscribes to the scratch folder. The Pod's notification service answers with an address to listen at, and tells the app about each change there, whoever made it.",
    watchFor: "The notification travels from the service back to the app.",
    steps: [
      {
        step: "subscribe",
        from: "app",
        to: "notification-service",
        provenance: "seen",
        purpose: `Subscribe to changes to ${scratch}, over a WebSocket.`,
        explanation:
          "The storage description named this subscription service. The service checks Alice may read the folder, then answers with the address to listen at. Anyone with that address can listen, so it's shortened here.",
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
        purpose: "Open the WebSocket the channel named, to receive notifications.",
        explanation: "No token is sent: holding the address is what lets the app listen.",
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
        purpose: `A notification: Add of ${scratch}note.txt.`,
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
        purpose: "Create a note in the scratch folder.",
        explanation: "The Pod answers with the new note's version, its ETag.",
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
        purpose: "Read the scratch folder again, to list the new note.",
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
      "Alice has a folder, private/, whose access rules let in only one other app. Logging in doesn't change that: this app acts as Alice, but the Pod's rules can name apps too, so it refuses this one.",
    watchFor: "The refused request is marked, with the status the Pod gave.",
    steps: [
      {
        step: "readContainer",
        from: "app",
        to: "pod",
        provenance: "seen",
        purpose: "Read the top folder of Alice's Pod again.",
        explanation: "The top folder lists private/ among what it holds.",
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
        purpose: "Read the private folder, as Alice, through this app.",
        explanation:
          "The token and proof are as good as before, but the folder's rules name the apps that may read it, and this isn't one. The Pod answers 403: it knows who is asking, and won't let this app in.",
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
