# 0009. Identify the app with a Client ID Document only

- **Status:** Proposed
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

A Solid app can identify itself to an identity provider with a Client ID Document, a JSON-LD file at a URL on the app's own origin, or by registering on the fly with dynamic client registration.
The demonstrator supports Client ID Documents only, and explains the failure when an identity provider doesn't accept them.

## Context

Solid-OIDC defines Client ID Documents as the way for a Solid app to identify itself, and also allows dynamic registration.
The reference broker, `id.huwdiprose.co.uk`, accepts Client ID Documents and offers no dynamic registration: on 27 November 2026 its discovery document had `client_id_metadata_document_supported: true` and no `registration_endpoint`.
Which methods other identity providers accept, including the Community Solid Server's, has not yet been checked.
Some may accept only dynamic registration.

Dynamic registration would also let local development work against remote identity providers, which can't fetch a Client ID Document on `localhost`.

## Options considered

### Client ID Documents only (chosen)

- One way to identify the app, to build and to explain.
- The consent page at the identity provider can show the app's name and URL from the document, which is how Solid-OIDC expects apps to appear.
- Identity providers that only support dynamic registration can't be used, and the demonstrator says so.

### Both, preferring Client ID Documents

Works with more identity providers, and shows a second way for an app to identify itself, at the cost of another path to build, test and explain.

### Dynamic registration only

Works on `localhost` against any identity provider that supports it, but not with the reference broker.

## Decision

Proposed: the demonstrator identifies itself with a Client ID Document only.
It checks the identity provider's discovery document for `client_id_metadata_document_supported`, and explains the failure if it is missing.

## Consequences

- Local development runs against a local stack, where the identity provider can reach the Client ID Document.
- If testing against hosted providers finds common ones that need dynamic registration, a new record should revisit this.
