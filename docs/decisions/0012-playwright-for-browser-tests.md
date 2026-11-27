# 0012. Test browser behaviour with Playwright, and core logic with node:test

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

Tests of the steps, trace and redaction run in Node with `node:test`, with full coverage.
Tests that need a real browser, such as the interface, redirects, CORS and stored keys, run with Playwright, in Chromium, Firefox and WebKit, against the local test stack.

## Context

[Decision 0010](0010-lit-and-vite.md) splits the code into `src/core`, which runs in Node and the browser, and `src/app`, which runs only in the browser.
Node has WebCrypto and `fetch`, so `src/core` can be tested there, as solid-oidc tests its code.
Some behaviour exists only in a browser: navigating away to log in and back, CORS refusals, IndexedDB keys, and the interface itself.
CORS and redirect handling differ between browsers.

## Options considered

### Playwright, with node:test for core logic (chosen)

- Playwright drives Chromium, Firefox and WebKit, so differences between browsers show up in tests.
- It handles journeys across several sites, such as the app, an identity provider and a Pod, which login tests need.
- It is a large development dependency, and needs browser binaries, which devenv can provide.

### Defer browser tests until login

Discovery is mostly fetching and parsing, which `node:test` covers.
The interface would still go untested until milestone 2, and adding browser tests later means retrofitting them to existing screens.

### Web Test Runner

Runs test files in a real browser, which suits testing components in isolation, but is weaker at full journeys across several sites.

## Decision

`src/core` is tested with `node:test`, with 100% line, branch and function coverage.
`src/app` and whole journeys are tested with Playwright, in Chromium, Firefox and WebKit, against the local test stack.

## Consequences

- The coverage figure in `pnpm run test` covers `src/core` only. The interface is covered by browser tests instead, which measure behaviour rather than lines.
- CI needs a job that installs browsers and runs the Playwright tests.
- Playwright arrives with the first browser tests, in milestone 1.
