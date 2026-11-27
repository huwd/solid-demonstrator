# 0014. Use oauth4webapi for PKCE, DPoP and token requests, through the traced fetch

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

The login steps use `oauth4webapi` for PKCE, DPoP proofs, the code exchange and checking what the identity provider returns.
Every request it makes goes through the traced `fetch`, so the timeline still shows each one, with a purpose the step chose.
Discovery, dynamic client registration and the order of the steps stay the demonstrator's own code.

## Context

[Decision 0002](0002-build-the-solid-flow-by-hand.md) has the demonstrator build the Solid flow as its own named steps, with a small, low-level OAuth library for the cryptographic and protocol detail.
It named `oauth4webapi` as the expected library, and left the choice to a later record, made when login is built in milestone 2.

The library must not make requests the trace can't see, or decide the order of the steps.
It must run in the browser on WebCrypto, so the DPoP key can be a non-extractable key ([decision 0008](0008-tokens-in-memory-key-in-indexeddb.md)), and in Node, so the steps can be tested with `node:test` ([decision 0012](0012-playwright-for-browser-tests.md)).

## Options considered

### oauth4webapi (chosen)

- Version 3.8.9 is MIT-licensed, with no dependencies, and runs on WebCrypto in browsers and Node.
- It handles PKCE, DPoP proofs, retrying when the identity provider asks for a DPoP nonce, the code exchange, and checking token responses and ID tokens.
- Each function makes at most one request, and accepts a `customFetch` that the demonstrator points at the traced `fetch`. That `fetch` returns a recorded result rather than a `Response`, so a small adapter rebuilds one.
- It's the foundation of `openid-client`, which solid-oidc uses, so the two projects rest on the same code.
- Version 3 has no helpers for dynamic client registration. Registration is one JSON request, which the demonstrator makes itself.

### Writing the steps by hand on WebCrypto

PKCE and DPoP proofs are short, but checking ID tokens is security-sensitive, and decision 0002 already rejected putting that in a teaching tool.
Choosing this would mean superseding decision 0002.

### Deciding later

Parts of milestone 2 need no library: the Client ID Document and the local test environment.
The code exchange is the centre of the milestone, though, and how the steps are written depends on the library, so delaying the choice would delay the rest.

## Decision

The login steps use `oauth4webapi`, pinned exactly, for PKCE, DPoP proofs, the code exchange and checking the identity provider's responses.
Every request it makes goes through the traced `fetch`, using its `customFetch` option.
The demonstrator's own code does discovery, which milestone 1 built, dynamic client registration, and the order of the steps.

## Consequences

- The timeline shows every request the login makes, as it does for discovery.
- Each step calls a library function, so reading the code of a step shows what happens, but not every check the library makes. The trace entry for the step explains those checks.
- Upgrades to `oauth4webapi` arrive through Dependabot, after the two-day wait, and need checking against real identity providers.
- `oauth4webapi` can also validate JWT access tokens, which may serve milestone 3's repeated signature check instead of `jose`. That is for a later record.
