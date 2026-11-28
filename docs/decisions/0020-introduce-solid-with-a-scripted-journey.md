# 0020. Introduce Solid with a scripted journey, then let people try it for real

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-28
- **Recorded:** 2026-11-28
- **Discussion:** Planning session for milestones 6 and 7, 28 November 2026 (no issue)
- **Supersedes:** [0006](0006-tour-from-recorded-journeys.md)

## Summary

The demonstrator opens with a scripted journey that shows how Solid is expected to work, for a fictional person on fictional servers.
It draws the parties, then the exchanges between them, then the detail of each, in the views of [decision 0018](0018-show-the-journey-as-a-map-timeline-and-detail.md).
It ends with "Try it yourself", where a person's own WebID runs the real flow through the same views.
The script is written from the specifications, not recorded, and is always labelled as an example.

## Context

Outcome 13 in [OUTCOMES.md](../../OUTCOMES.md) asks for a tour of the whole journey that needs no Solid account.
[Decision 0006](0006-tour-from-recorded-journeys.md) planned to build it by running the real steps against recorded answers from real servers in a test environment.
[Decision 0015](0015-test-against-fictional-and-live-servers.md) then left out the local stack those recordings were to come from.

A recording also can't be replayed faithfully once it's safe to publish.
Redaction removes access tokens and their signatures ([decision 0005](0005-redact-secrets-in-one-place.md)), so steps such as verifying the token's signature can't run again on a recorded answer.

Most readers meet Solid through the demonstrator before they have a WebID.
The published descriptions of Solid have no picture of its parties or flows, and the explainers reviewed for decision 0018 introduce a protocol with a narrated, scripted scenario before showing anything live.

## Options considered

### A scripted journey, then the real flow (chosen)

- A script in `src/core` holds chapters. Each has narration and the exchanges it shows, with their route, an example request and response with a note on each field, and the specification.
- The chapters run from how the parties fit together, through discovery, login, reading and writing, and notifications, to a refusal.
- The same map, timeline and detail components draw the script or a live trace. Script entries are a type of their own, never trace entries, so the trace holds only what happened ([decision 0004](0004-label-how-each-step-is-known.md)).
- A person steps through it, or plays it. The map adds parties and animates each exchange. The parties then move into the timeline's lanes, and each exchange opens in the detail panel.
- It needs no servers, recording or capture script. It can show a refusal or a failure on cue, and its narration can say what to watch for.
- It costs keeping the script true to what the app does. Two tests check that:
  - a browser test runs the live flow against the fictional servers, and compares its steps with the script's, in order
  - a Node test passes every example through the redaction module, and fails if anything changes, so an example never shows what a real session would hide

### Real steps replayed from recordings

- [Decision 0006](0006-tour-from-recorded-journeys.md)'s plan: the steps, trace and views are the code of a live session, and only the `fetch` differs.
- It lost because it needs a test environment of real servers that the project doesn't have, and because a published recording has had the values removed that some steps need to run again.

### A recorded trace played through the views

- A live session as a fictional person, exported as a redacted trace, and played back through the views.
- It shows real behaviour, but only what one session happened to do. It can't be narrated or changed without capturing it again, and a refusal must be staged on a live server.

## Decision

The demonstrator opens with a scripted journey, written from the specifications for a fictional person on fictional servers, and drawn in the views of decision 0018.
Every part of it is labelled as an example, and it never adds entries to the trace.
It ends with "Try it yourself": a person enters their own WebID, or follows a link to get one, and the real flow runs through the same views.

## Consequences

- Outcome 13 changes: the tour's exchanges are examples written from the specifications, not captured from real servers.
- The script is tested against the live flow's steps, so a change to the steps fails until the script follows it.
- The scripted journey becomes the start page, ahead of the WebID box. Discovery still starts from the WebID ([decision 0001](0001-start-from-the-webid.md)).
- Milestones 6 and 7 in [PLAN.md](../../PLAN.md) merge around the scripted journey. The export of a redacted trace (outcome 11) sits with "Try it yourself".
- The script names only fictional hosts, as [decision 0003](0003-static-app-for-any-solid-stack.md) allows for examples.
