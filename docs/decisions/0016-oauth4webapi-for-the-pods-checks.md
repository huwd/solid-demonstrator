# 0016. Use oauth4webapi to repeat the Pod's checks of the token and DPoP proof

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

When the demonstrator repeats a Pod's checks of a request, it uses `oauth4webapi`'s `validateJwtAccessToken`.
That one call checks the access token's signature against the issuer's keys, its claims, and the DPoP proof sent with the request.
It fetches the issuer's keys through the traced `fetch`.
`oauth4webapi` follows RFC 9068, which asks more of a token than Solid-OIDC does.
Where it refuses a token for a rule that Solid-OIDC doesn't make, the demonstrator says so, rather than saying the Pod would refuse.

## Context

Outcome 7 has the demonstrator show why a Pod trusts a request.
It repeats the Pod's checks and labels them *repeated* ([decision 0004](0004-label-how-each-step-is-known.md)):

1. the DPoP proof matches the request's method and URL, and the token's key
2. the profile of the WebID named in the token names the token's issuer
3. the token is signed with one of the issuer's keys

The second check already exists, from milestone 2.
`PLAN.md` expected `jose` for the signature, and [decision 0014](0014-oauth4webapi-for-oauth-steps.md) noted that `oauth4webapi`, already a dependency, might serve instead.

`oauth4webapi` 3.8.9's `validateJwtAccessToken` is written for resource servers.
Given the request a Pod would receive, it:

- fetches the issuer's keys from its `jwks_uri`, through `customFetch`
- checks the token's signature and its `iss`, `aud`, `exp` and `iat`
- checks the signature, `htm`, `htu`, `iat` and `ath` of the DPoP proof, and that its key matches the token's `cnf.jkt`

It also applies RFC 9068's profile for JWT access tokens.
That profile requires a `typ` of `at+jwt`, and `jti`, `sub` and `client_id` claims.
Solid-OIDC requires `client_id` too, but not the others.

## Options considered

### `oauth4webapi` (chosen)

- No new dependency, and the same library that made the token request checks the token, so the two can't disagree about formats.
- One call covers the signature, the claims and the DPoP proof, including `ath`, which ties the proof to this token.
- It is stricter than a Solid Pod need be. A provider whose tokens a real Pod accepts could fail its check.
- One call makes the checks harder to show one by one. The trace entry has to explain what the call checked.

### `jose`

- One more dependency, with none of its own.
- The demonstrator would choose each check, so it could follow Solid-OIDC's rules exactly, and give each check its own verdict.
- The DPoP proof checks, such as `htu` normalisation and `ath`, would be the demonstrator's own code.

### WebCrypto directly

The most transparent, but it means parsing JWS and choosing algorithms by hand.
[Decision 0002](0002-build-the-solid-flow-by-hand.md) keeps security-sensitive checks in a library.

## Decision

The demonstrator repeats the Pod's token and DPoP proof checks with `oauth4webapi`'s `validateJwtAccessToken`, pinned exactly, with the issuer's keys fetched through the traced `fetch`.
The WebID check stays the demonstrator's own code.

When the check fails, the demonstrator looks at why.
If the only reason is an RFC 9068 rule that Solid-OIDC doesn't make, such as a missing `jti` or a `typ` other than `at+jwt`, it says the token doesn't meet RFC 9068, and that a Solid Pod need not refuse it for that.
It says the Pod would refuse only for a reason a Solid Pod would refuse for.

## Consequences

- No new dependency is added for milestone 3. `PLAN.md`'s dependency table no longer lists `jose`.
- The trace entry for the check lists everything the call checked, since the code shows one call.
- The demonstrator keeps a list of the RFC 9068 rules that go beyond Solid-OIDC, and tests each against `oauth4webapi`'s errors. An `oauth4webapi` upgrade that changes those errors shows up as a failing test.
- If real providers often fail RFC 9068's rules, so that the demonstrator mostly reports a technicality, a later record can move the check to `jose`.
