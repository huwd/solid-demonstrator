# 0005. Redact secrets in one place, with fixed rules for each kind of value

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

The demonstrator shows requests and responses that carry credentials.
One module redacts every trace entry, before it is stored, shown or exported, following fixed rules for each kind of value.
Raw tokens and refresh tokens never appear; DPoP proofs appear in full, because they are safe to show and help explain DPoP.

## Context

The trace holds access tokens, ID tokens, refresh tokens, authorisation codes, PKCE values, `state` and DPoP proofs.
People will screen-share the demonstrator and export traces to show others.
A rule applied case by case, in each step, would eventually miss a value.

## Options considered

### One redaction module with fixed rules (chosen)

| Value | Shown as |
| --- | --- |
| Access, ID and refresh tokens | Never raw. Header and claims of access and ID tokens are decoded and shown; signatures are not. Refresh tokens are not shown at all. |
| Authorisation code, PKCE verifier and challenge, `state` | Shortened |
| DPoP proofs | In full: each is single-use and bound to one method and URL |
| The browser's DPoP private key | Never: it is generated as non-extractable |

- Steps can't bypass redaction, since the traced `fetch` applies it before anything is stored.
- The rules can be tested directly, including with real tokens.
- Decoded claims are still personal data, such as the WebID, which is expected: a trace is about the person using it.

### Redact in each step

Each step knows its own values best, but every new step is another chance to forget one.

### Show nothing sensitive at all

Safer, but tokens' claims and DPoP proofs are central to the explanation.

## Decision

All redaction happens in one module, which the traced `fetch` applies to every entry before it is stored.
The rules are those in the table above.
Exports apply the same rules, and store nothing the screen would not show.

## Consequences

- The redaction module needs tests that feed it real tokens and check that no raw token, refresh token or signature survives anywhere in an entry.
- A new kind of credential needs a rule in the module before any step may record it.
