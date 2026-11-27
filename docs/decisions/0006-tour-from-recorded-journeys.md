# 0006. Build the tour from recordings of the real steps against fictional servers

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

People without a Solid account can take a tour of the full journey without logging in.
The tour runs the demonstrator's real steps with a `fetch` that answers from a recorded journey.
The recording is captured from real servers in the test environment, for fictional people, so the tour shows real behaviour and no real person's data.

## Context

The demonstrator's main reader is a developer new to Solid, who is likely to have no WebID.
Without one, they can't log in anywhere, and the live journey stops at the start page.
Someone who enters another person's public WebID can see discovery, but stops at that person's identity provider.

The agreed answer, recorded in outcome 13 of [OUTCOMES.md](../../OUTCOMES.md), is a sign-up link to a public provider and a tour that needs no login.
This record covers how the tour is built.

## Options considered

### Real steps, replayed from recordings (chosen)

The steps, trace, redaction and views are the same code as a live session; only the `fetch` differs.
A script captures the recording by running the live app against the test environment, and is run again when the steps or server versions change.

- The tour can't show behaviour the live app doesn't have.
- The recording is real server output, but holds only fictional identities and test keys.
- Login redirects can't be replayed, so the tour replaces them with an explained interlude.

### A separately scripted demonstration

Hand-written screens and responses.
Easier to make polished, but it can drift from the real app, and would be a second thing to maintain.

### A recording of the reference stack's owner

Real and personal, but it would publish details of a real deployment and account, and need re-recording by that one person.

## Decision

The tour replays recordings of the real steps against the test environment, for fictional people, through the same code as a live session.

## Consequences

- The test environment has to be stable enough for a script to capture recordings repeatedly.
- The tour is only as current as its last recording, so recording is part of updating servers or steps.
