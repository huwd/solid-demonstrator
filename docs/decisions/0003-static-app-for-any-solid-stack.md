# 0003. Ship a static app that works with any compliant Solid stack

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

The demonstrator is a set of static files with no server of its own.
It builds in nothing about any particular WebID host, identity provider or Pod, so anyone can use it to explore their own Solid stack, not only the reference stack it was built alongside.
Any static host can serve it.

## Context

The demonstrator was prompted by a new self-hosted stack: a WebID at `huwdiprose.co.uk`, a Solid-OIDC broker at `id.huwdiprose.co.uk` and a Community Solid Server Pod at `pod.huwdiprose.co.uk`.
That stack is the first to be explored with it, but the aim is to explain Solid, not that deployment.

A Solid app identifies itself to an identity provider with a Client ID Document, published at a URL on the app's own origin.
The identity provider fetches it, and allows token requests from browsers only from the origins of its redirect URIs.

## Options considered

### Static, with nothing built in (chosen)

- No server can see a person's tokens or data, so the demonstrator can't leak them beyond the parties the person chose.
- Hosting is cheap and interchangeable: GitHub Pages and Cloudflare Pages both work.
- Things a server could have done, such as receiving webhook notifications, are out of scope.
- Each deployment needs a Client ID Document that names its own origin, so the build generates it.

### Built for the reference stack

Faster to build, but the explanation would be true only of one deployment, and nobody else could use it.

### With a small server

A server could receive webhooks, or exchange codes as a confidential client.
It would add hosting and a party that sees tokens, and a confidential client is not how most Solid apps work, so it would explain a less common flow.

## Decision

The demonstrator is a static single-page app.
It discovers everything from the WebID or identity provider the person gives it, and contains no stack-specific values except in examples and test fixtures.
The build writes the Client ID Document from a `SITE_URL` setting.

## Consequences

- Testing must cover more than one shape of stack, including a single-service hosted provider as well as the split reference stack.
- A remote identity provider can't fetch a Client ID Document on `localhost`, so local development runs against a local stack.
- Webhook notifications are out of scope; WebSocket notifications are in.
