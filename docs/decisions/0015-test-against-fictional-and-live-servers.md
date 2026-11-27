# 0015. Test against fictional and live servers, without a local stack for now

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)
- **Supersedes:** [0012](0012-playwright-for-browser-tests.md)

## Summary

Tests of the steps, trace and redaction still run in Node with `node:test`, with full coverage.
Browser tests still run with Playwright, in Chromium, Firefox and WebKit, but against fictional servers that Playwright answers, rather than a local stack.
Real logins are tried on the deployed site, against real identity providers.
A local stack of real servers is left for later.

## Context

[Decision 0012](0012-playwright-for-browser-tests.md) planned browser tests against a local stack: a Docker Compose environment with the solid-oidc broker and Community Solid Servers.

Building login, in milestone 2, showed what that stack would cost.
The broker fetches a Client ID Document only over HTTPS, even on `localhost`, so the stack would need its own certificate authority.
solid-oidc's sandbox shows one way: the app stays on plain `http://localhost`, and only the Client ID Document is served over HTTPS.
That needs a second setting for where the document lives, alongside `SITE_URL`.
The other way, serving the whole app over HTTPS, needs each developer's browser to trust a local certificate authority.

Meanwhile, the app is deployed on GitHub Pages ([decision 0013](0013-deploy-to-github-pages.md)), with a Client ID Document that identity providers on the internet can fetch.

## Options considered

### Fictional servers in tests, and live servers by hand, for now (chosen)

- Browser tests answer requests with fictional profiles, identity providers and Pods through Playwright, as the discovery tests already do.
- Real logins are tried on the deployed site: with the broker, which accepts its Client ID Document, and with providers such as solidcommunity.net that offer dynamic registration instead.
- No certificates, containers or extra settings.
- Behaviour that only a real server shows is found by hand, on the deployed site, after merging, rather than in CI before.
- Playwright's answers skip the browser's CORS check, so CORS is tested against a real local server, as the discovery tests do.

### A local stack, copying solid-oidc's sandbox

Real servers in CI, as decision 0012 planned, but with a certificate authority, a second setting for the Client ID Document's address, and containers to keep up to date.

### A local stack, all over HTTPS

One setting covers everything, but each developer's browser must trust a local certificate authority, which changes their system's trust store.

## Decision

`src/core` is tested with `node:test`, with 100% line, branch and function coverage.
`src/app` and whole journeys are tested with Playwright, in Chromium, Firefox and WebKit, against fictional servers that Playwright answers, and real local servers where the browser's own behaviour is the subject, such as CORS.
Real logins are tried by hand on the deployed site.
The demonstrator has no local stack of real Solid servers for now.

## Consequences

- CI needs no containers, and tests stay fast.
- A difference between real servers and the fictional ones shows up only when someone tries the deployed site. Each one found becomes a recorded fixture, as solid-oidc's tests do.
- The tour's recorded journey ([decision 0006](0006-tour-from-recorded-journeys.md)) was to be captured from the local stack. It will need another source, or the stack, by milestone 7.
- A local stack can still be added later, following solid-oidc's sandbox, if testing by hand proves too slow or misses too much.
