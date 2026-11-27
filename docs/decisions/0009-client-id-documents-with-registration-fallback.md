# 0009. Identify the app with a Client ID Document, falling back to dynamic registration

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

A Solid app can identify itself to an identity provider in two ways.
It can give a Client ID Document, a JSON-LD file at a URL on the app's own origin that the identity provider fetches, or it can register on the fly with dynamic client registration.
The demonstrator uses a Client ID Document wherever the identity provider accepts one, and falls back to dynamic registration where it doesn't.
It shows which method it used and why, so a reader sees both ways an app can identify itself.

## Context

Solid-OIDC defines Client ID Documents as the way for a Solid app to identify itself, and also allows dynamic registration.
The reference broker, `id.huwdiprose.co.uk`, accepts Client ID Documents and offers no dynamic registration: on 27 November 2026 its discovery document had `client_id_metadata_document_supported: true` and no `registration_endpoint`.
Which methods other identity providers accept, including the Community Solid Server's, has not yet been checked.
Some may accept only dynamic registration.

[Decision 0003](0003-static-app-for-any-solid-stack.md) commits the demonstrator to working with any compliant Solid stack, so people can explore their own.
A remote identity provider can't fetch a Client ID Document on `localhost`, but it can register a client whose redirect URI is on `localhost`.

## Options considered

### Client ID Document first, dynamic registration as a fallback (chosen)

The identity provider's discovery document decides the method: `client_id_metadata_document_supported` means a Client ID Document, and otherwise a `registration_endpoint` means dynamic registration.

- Works with more identity providers, which suits exploring any stack.
- Shows a second way for an app to identify itself, and the difference between them: with a Client ID Document, the identity provider can show a URL that proves where the app's details came from; with dynamic registration, the app asserts its own name and nothing backs it.
- Local development can run against remote identity providers that support dynamic registration.
- Another path to build, test and explain in milestone 2, and another kind of failure to diagnose.

### Client ID Documents only

One method to build, test and explain, and the one Solid-OIDC centres.
Identity providers that only support dynamic registration would fail, which works against exploring any stack.

### Dynamic registration only

Works on `localhost` against any identity provider that supports it, but not with the reference broker.

## Decision

The demonstrator identifies itself with a Client ID Document when the identity provider's discovery document has `client_id_metadata_document_supported: true`.
Otherwise, if it advertises a `registration_endpoint`, the demonstrator registers itself as a public client, with no client secret, and the registration request and response appear in the trace.
If the identity provider supports neither, the demonstrator stops and explains why.
The person can see which method was used, and why, in both views.

## Consequences

- Milestone 2 builds and tests both methods, and the test environment needs an identity provider that offers dynamic registration.
- A dynamically registered client is not shared between visits, so the demonstrator registers again whenever it has no registration for that identity provider.
- The explanation of consent has to cover both methods, including why a name from dynamic registration is only what the app claims.
