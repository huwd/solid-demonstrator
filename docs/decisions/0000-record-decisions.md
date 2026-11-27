# 0000. Record decisions in lightweight decision records

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

Significant choices about the demonstrator are recorded in short Markdown files, so their reasons stay easy to find as the code changes.
Each record explains the choice, the alternatives considered and when the decision was made.
The format is the one [solid-oidc](https://github.com/huwd/solid-oidc/blob/main/docs/decisions/0000-record-decisions.md) uses, so records read the same across the Solid projects.

## Context

The demonstrator starts with choices that shape everything built on them: where a journey starts, whether to use a Solid login library, what it shows and hides, and how it is built and checked.
[OUTCOMES.md](../../OUTCOMES.md) and [PLAN.md](../../PLAN.md) describe what to build and how, but not which alternatives were rejected, or why.

One person, working with coding agents, makes most decisions.
The form must suit writing records without a team to review them, and give agents something concrete to check proposed changes against.

## Options considered

### solid-oidc's record format (chosen)

Michael Nygard's format (title, status, context, decision and consequences) with a short summary, an "Options considered" section and separate "Decided" and "Recorded" dates, as in solid-oidc and the declarative laptop repository.
Using the same format across repositories means one set of habits and one template.

### Decisions in PLAN.md

Keep decisions as a section of the plan.
The plan describes work still to do and changes as work finishes, so a decision recorded there loses its date and the options that lost.

### No records

Rely on commit messages and pull requests.
These are hard to find again, and they explain a line of code rather than the alternatives that lost.

## Decision

Record significant decisions as numbered Markdown files in `docs/decisions/`, using [`template.md`](template.md).
[`README.md`](README.md) covers when and how to write one, and indexes them.
Records name who decided in a "Decided by" line, by GitHub handle, and avoid first-person pronouns.

## Consequences

- A proposed change can be checked against the accepted records, and a change that conflicts with one needs a new record first.
- Changing a decision means writing a new record and marking the old one superseded.
- Records add some writing for each significant change.
  The "When to write one" section keeps that effort for decisions that need it.
