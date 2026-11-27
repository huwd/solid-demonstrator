# 0002. Build the Solid flow by hand, not with a Solid login library

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

The demonstrator implements discovery, login and Pod requests itself, as a sequence of short, named steps.
It doesn't use a Solid login library, because those libraries are designed to hide the steps the demonstrator exists to show.
A small, low-level OAuth library handles the cryptographic and protocol detail, so each step stays short.

## Context

A Solid login involves fetching a WebID profile, discovering the identity provider, sending the person to it with PKCE, exchanging the code with a DPoP proof, and then sending a fresh DPoP proof with every Pod request.
The demonstrator must record each of these, with its purpose and result, as it happens.
Its source code is also meant to read as a second explanation of the flow.

## Options considered

### Named steps over a low-level OAuth library (chosen)

Each step is one function, named after what it does, that makes its requests through an injected, traced `fetch`.
A low-level library supplies PKCE, DPoP proofs and token request handling, without deciding the order of steps or making requests the demonstrator can't see.
`oauth4webapi` is the expected choice: it uses WebCrypto, runs in browsers and Node, and supports DPoP and Client ID Documents.

- Every request goes through the trace, with a purpose the demonstrator chose.
- The code for each step is short enough to read alongside its trace entry.
- The demonstrator takes on code that a login library would otherwise maintain, and must be tested against real servers to stay correct.

### `@inrupt/solid-client-authn-browser`

The most widely used Solid login library.
It handles discovery, login, token storage and refresh behind a session object, and makes authenticated requests through its own `fetch`.
Its requests could be observed by wrapping that `fetch`, but its steps, ordering and storage would stay hidden, and the demonstrator would describe a library's behaviour rather than the protocol's.

### Writing the cryptography by hand too

Implement PKCE, DPoP and token handling directly on WebCrypto.
It shows even more, but it puts security-sensitive code in a teaching tool, and the detail would bury the flow the demonstrator is meant to explain.

## Decision

The demonstrator implements the Solid flow as its own named steps.
It uses a low-level OAuth library for PKCE, DPoP and token requests, chosen in a later record, and no Solid login library.

## Consequences

- Tests run the steps against real identity providers and Pods, as solid-oidc's [decision 0010](https://github.com/huwd/solid-oidc/blob/main/docs/decisions/0010-test-against-real-implementations.md) does for the broker.
- Refresh, logout and storage across the login redirect are the demonstrator's own code, and need their own decisions.
- Behaviour that differs between Solid servers shows up as a failure in the demonstrator, rather than being smoothed over by a library.
