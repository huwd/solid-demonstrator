# Plan

This plan sets out how to build Solid Demonstrator to meet [OUTCOMES.md](OUTCOMES.md). It covers the architecture, how each step is recorded and explained, how it is tested, and the order of work. It was written on 27 November 2026, before any code existed.

The project follows the conventions of [solid-oidc](https://github.com/huwd/solid-oidc): TypeScript, `node:test` with full coverage, Biome, pinned dependencies, plain British English in the GOV.UK style, decision records in `docs/decisions/`, and a changelog.

## Approach

The demonstrator is a single-page app built to static files. It has no server and no backend state.

It implements the Solid flow by hand, as a sequence of named steps, rather than using a Solid login library. Libraries such as `@inrupt/solid-client-authn-browser` are designed to hide the steps, and the demonstrator exists to show them. A small, low-level library does the cryptographic and protocol detail, so each step stays short and readable.

Every step records what it did in a shared trace. The outcome view and the plumbing view both read from that trace, so they can't disagree.

## Architecture

### Steps

Each step is one function, named after what it does, such as `fetchWebIdProfile`, `discoverIssuer`, `exchangeCode` or `readResource`. A step:

- takes what earlier steps found, and returns what later steps need
- makes its requests through the traced `fetch` described below, giving each a purpose in plain English
- states what it expects, so a failure can say what was expected and what happened
- adds explained entries for what happens out of the app's sight, such as the identity provider handing off to an upstream login

The journey is the list of steps in order. The interface moves through the journey, and the person can retry a failed step where the protocol allows.

### The trace

The trace is a list of entries. Each entry records:

| Field | Holds |
| --- | --- |
| Step | Which step made it |
| From and to | The parties involved |
| Purpose | Why, in one sentence |
| Provenance | Seen, reconstructed, repeated or explained, as defined in outcome 9 |
| Request and response | Method, URL, headers, status and body, after redaction |
| Expected and verdict | What the step expected, and whether it got it |
| Explanation | What a reader should take from it, and a link to the relevant specification section |

A traced `fetch` wraps the browser's `fetch`. It is passed into each step rather than replacing the global, as the solid-oidc style guide requires. It records the request and response, applies redaction before anything is stored, and classifies failures (see [Diagnosing failures](#diagnosing-failures)).

### Redaction

Redaction is one module that applies the rules in outcome 11 to every entry, before it is stored, shown or exported. Nothing else in the app decides what is safe to show. It has its own tests, including ones that feed it real tokens and check that no raw token, refresh token or signature survives anywhere in an entry.

### Surviving the redirect

Login sends the browser away to the identity provider and back, which reloads the app. To survive that:

- The trace, PKCE verifier, `state` and chosen identity provider are kept in session storage for the tab.
- The DPoP key pair is generated with WebCrypto as non-extractable and kept in IndexedDB, which can store a key object without exposing the private key.
- Tokens are kept in memory only. Reloading the page after login means logging in again. This is a deliberate trade for a demonstrator, proposed in [decision 0008](docs/decisions/0008-tokens-in-memory-key-in-indexeddb.md).

On return, the app adds reconstructed entries for the redirect to the identity provider and the redirect back, from what it sent and the query parameters it received.

### Repeating the Pod's checks

Outcome 6 asks the demonstrator to show what the Pod does to trust a request. Three of those checks only need public data, so the app repeats them in the browser and records them as repeated entries:

1. Fetch the WebID profile named in the token's `webid` claim.
2. Check that it names the token's `iss` as a `solid:oidcIssuer`.
3. Fetch the issuer's `jwks_uri` and verify the access token's signature.

Checking the DPoP proof and the access rules happen only on the Pod, so those are explained entries.

### Views

- **Outcome view:** a plain app interface for the WebID, login, Pod browser and notifications.
- **Plumbing view:** a timeline of trace entries, an inspector for the selected entry, and a sequence diagram of the parties drawn from the trace, with the current or failed step highlighted.

Both views render the same journey and trace. Switching views keeps the person's place.

### How the app identifies itself

[Decision 0009](docs/decisions/0009-client-id-documents-with-registration-fallback.md) sets the order: a Client ID Document where the identity provider accepts one, and dynamic client registration where it doesn't. The identity provider's discovery document decides: `client_id_metadata_document_supported` means a Client ID Document, and otherwise a `registration_endpoint` means dynamic registration.

The app publishes its Client ID Document at `/clientid.jsonld`. Its `client_id` and `redirect_uris` depend on the origin the app is served from, so the build writes the document from a `SITE_URL` setting. The identity provider allows token requests only from the origins of the `redirect_uris`, so the document must match the origin the app runs on.

With dynamic registration, the app sends its name and redirect URIs to the `registration_endpoint` as a public client, with no client secret, and gets a `client_id` back. The registration request and response appear in the trace like any other exchange.

Hosting is otherwise open. GitHub Pages and Cloudflare Pages both work. Cloudflare Pages preview deployments each have their own origin, so each preview would need its own build of the document.

### Diagnosing failures

The traced `fetch` classifies each failure:

- **HTTP errors:** the status, the relevant headers such as `WWW-Authenticate`, and an OAuth error body if there is one.
- **Protocol mismatches:** a missing `solid:oidcIssuer`, an `iss` or `state` that doesn't match, an identity provider that accepts neither a Client ID Document nor dynamic registration.
- **Blocked or unreachable:** the browser raises the same error for a CORS refusal, a DNS failure or a refused connection, and hides which. The app then repeats the request with `mode: "no-cors"`. If that gets an opaque response, the server is reachable and the likely cause is CORS. The diagnosis is labelled as a diagnosis.

### The tour

The tour (outcome 13) runs the real steps with a different `fetch`: one that answers from a recorded journey instead of the network. The steps, trace, redaction and views are the same code as a live session, so the tour can't show behaviour the live app doesn't have.

- The recorded journey is captured by running the live app against the Compose environment described under [Testing](#testing), as a fictional person on fictional servers. A script captures it again whenever the steps or server versions change.
- Redaction runs on the recording before it is saved, as on any trace. The recording holds only fictional identities and test keys, so it holds nothing sensitive even before redaction.
- The redirects to the identity provider are replaced by a short explained interlude, since there is no real login page to visit.
- The tour includes a refusal: a second fictional WebID that the Pod refuses with `403`.
- A tour banner and a distinct style mark every tour screen.

### Dependencies

To be confirmed in a decision record, with each pinned exactly:

| Need | Candidate |
| --- | --- |
| OAuth, PKCE and DPoP | `oauth4webapi`, which uses WebCrypto and supports DPoP and Client ID Documents |
| Verifying the access token's signature | `jose` |
| Parsing Turtle and JSON-LD | `n3` for Turtle; a small JSON-LD reader, or `jsonld` if needed |
| Building the static app | Vite |
| Interface | Plain TypeScript and DOM, or a small library such as Lit. Decide in milestone 1. |
| Browser tests | Playwright, if the end-to-end tests below need a real browser |

## Testing

Following solid-oidc's [decision 0010](https://github.com/huwd/solid-oidc/blob/main/docs/decisions/0010-test-against-real-implementations.md), tests run against real implementations rather than scripted stubs where they can.

- **Steps and modules:** `node:test`, with full coverage. Node has WebCrypto and `fetch`, so the steps run in Node with a traced `fetch` pointed at local servers.
- **Real servers:** a Docker Compose environment with:
  - the solid-oidc broker and its sandbox, for a split stack with an upstream login
  - a Community Solid Server with its own identity provider, for a single-service stack, and for dynamic registration if it offers it; otherwise another identity provider that does
  - a Community Solid Server with identity disabled, trusting the broker, matching the stack in [composer](https://github.com/huwd/composer)
  - static WebID profiles covering the cases in outcome 2: one issuer, several issuers, several Pods, and none
- **Fixtures:** recorded responses from real servers, for failures a real server won't produce on demand. Each fixture records where and when it was captured.
- **End to end:** the full journey in a browser against the Compose environment.

Identity providers fetch the Client ID Document themselves, so a remote provider can't reach one on `localhost`. Local development therefore runs against the Compose environment, where the broker allows loopback Client ID Documents, or uses dynamic registration with identity providers that offer it, since registration needs no fetch back to the app. Whether the Community Solid Server's identity provider accepts a loopback Client ID Document needs checking in milestone 2. Live providers are tested from a deployed build.

## Milestones

Each milestone ends with something a person can use, and with its documentation and changelog entry.

### 0. Set up the repository

- devenv, pnpm, markdownlint and Vale, matching solid-oidc, with Vale errors failing the build ([0007](docs/decisions/0007-toolchain.md)).
- CI that runs the checks, with read-only workflows and pinned actions.
- Decision records for the choices made in planning ([0000](docs/decisions/0000-record-decisions.md) to [0009](docs/decisions/0009-client-id-documents-with-registration-fallback.md)).

Biome, TypeScript and `node:test` join the checks with the first code, in milestone 1.

### 1. Discovery, with the trace and timeline

Outcomes 1, 2 and 9, without login.

- The steps from WebID to profile to identity provider discovery.
- The choice of identity provider and Pod where the profile offers more than one.
- The trace, traced `fetch`, redaction module and timeline.
- Failure diagnosis for discovery, including CORS.

At the end, anyone can type a WebID and see the full discovery chain on a deployed build.

### 2. Login

Outcomes 3, 4, 11 and 12.

- The Client ID Document, built from `SITE_URL`, and the fallback to dynamic client registration.
- PKCE, DPoP key generation and storage, the redirect, the return and the code exchange.
- Reconstructed and explained entries for the identity provider's side.
- The token inspector, and the check that the token's WebID names this issuer.
- Logout.
- The Compose environment for local testing.

At the end, a person can log in with the broker, a Community Solid Server and a hosted provider, and see each step.

### 3. Reading the Pod

Outcomes 5 (reading), 6 and 7.

- Authenticated requests with a fresh DPoP proof each time.
- The storage description, browsing containers and viewing resources.
- The repeated checks of the Pod's trust in the token.
- Explanations for `401` and `403`, and viewing access rules where the person has Control access.

### 4. Writing to the Pod

Outcome 5 (writing).

- Create, edit and delete, with `If-Match` on edits so the Pod refuses a write that would overwrite a newer change.

### 5. The diagram and the two views

- The sequence diagram drawn from the trace, with the current and failed steps highlighted.
- Switching between outcome and plumbing views at any point.

The timeline from milestone 1 serves as the plumbing view until then.

### 6. Notifications

Outcome 8.

- Finding the notification service from the storage description.
- Subscribing with `WebSocketChannel2023`, and showing each notification in both views.

### 7. Sharing and the tour

Outcome 11's export, and outcome 13.

- Exporting a redacted trace.
- The tour: a journey for a fictional person, replayed through the same steps and views as a live session. See [The tour](#the-tour).
- The sign-up link to public providers, and the explanation for someone who enters a WebID they can't log in as. Both are small enough to ship earlier, with milestone 2.

## Decisions

[`docs/decisions/`](docs/decisions/README.md) records the decisions this plan rests on. Check a change against the accepted records before making it.

Still to record:

- the low-level OAuth library and other dependencies, in milestone 1
- the interface library, in milestone 1
- the bundler and browser test tool, in milestone 1

## Risks

- **Hosted providers behave differently.** Providers differ in CORS headers, token claims and notification support. Testing against at least one hosted provider from milestone 2 onwards catches this early.
- **Explained steps drift from reality.** An explanation of what a server does can become wrong when the server changes. Each explained entry links the specification it relies on, and the Compose environment pins the server versions it was checked against.
- **Scope creep towards a full Pod browser.** Outcome 5 is limited to what shows the plumbing. Features beyond that need a reason tied to the outcomes.
