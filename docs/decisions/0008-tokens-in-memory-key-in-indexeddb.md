# 0008. Keep tokens in memory, and the DPoP key as a non-extractable key in IndexedDB

- **Status:** Proposed
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

Login sends the browser to the identity provider and back, which reloads the app.
The demonstrator keeps the values it needs across that reload in session storage, and its DPoP key pair in IndexedDB as a non-extractable key.
Tokens stay in memory only, so reloading the page after login means logging in again.

## Context

The app must survive the redirect to the identity provider: on return it needs the PKCE verifier, `state`, the chosen identity provider, the trace so far and the DPoP key the token will be bound to.
Tokens arrive after the redirect, from the code exchange, so they never need to survive it.
Anything kept in browser storage can be read by any script running on the page.

## Options considered

### Tokens in memory, key non-extractable in IndexedDB (chosen)

- WebCrypto can generate a key that can sign but can't be exported, and IndexedDB can store that key object without exposing the private key.
- No token is ever written to storage, so a script on the page can't read a token from storage after the tab is closed.
- Reloading the page loses the session. The demonstrator explains this when it happens.

### Tokens in session storage

Survives a reload within the tab, but puts tokens in storage any page script can read, in an app whose purpose includes showing good practice.

### Refresh silently on reload

Keep the refresh token in storage and use it on reload.
Smoother, but puts the longest-lived credential in storage, and refresh tokens are the one value the demonstrator never shows.

## Decision

Proposed: the demonstrator keeps tokens in memory only, keeps the DPoP key as a non-extractable key in IndexedDB, and keeps the other login values and the trace in session storage for the tab.

## Consequences

- A reload after login means logging in again, which the identity provider may make quick if its session is still active.
- Logout clears session storage and IndexedDB as well as memory.
