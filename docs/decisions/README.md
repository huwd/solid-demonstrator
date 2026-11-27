# Decision records

Significant decisions about this repository, one per file, with the context and the options that lost.
[0000](0000-record-decisions.md) explains why they exist and why they take this form.

## When to write one

Write a record when a decision:

- is costly or awkward to reverse, such as where a journey starts or how the app identifies itself
- chooses between real alternatives, and the losing options are worth remembering
- would leave a future reader asking "why is it like this?"
- changes what the demonstrator shows, hides or claims about another party

Routine changes don't need one.
When unsure, ask whether the reasoning would otherwise only live in a closed issue or a pull request description.

## Checking a change against the records

Before making a significant change, read the accepted records it touches.
A change that conflicts with an accepted record needs a new record that supersedes it, written and agreed before the change.
A proposed record is not yet in effect: settle it before building on it.

## How to write one

1. Copy [`template.md`](template.md) to `NNNN-short-slug.md`, using the next free number.
2. Fill in every section, starting with a short, plain-language summary of the problem, the choice and why it matters.
3. List the options that lost and why.
   This is often the most useful part.
4. Link the discussion, if there was one in an issue or pull request.
5. Add the record to the index below, then check it with `pnpm run check`.

### Voice

Name the people who made the decision in the "Decided by" line, by GitHub handle, such as @huwd.
In records, avoid first-person pronouns ("I" and "we").
Use concrete subjects and verbs, such as "The demonstrator keeps tokens in memory".
Anyone can propose a record, and it should read the same whoever wrote it.

### Dates

**Decided** gives the date of the decision; **Recorded** gives the date of writing.

### Status

| Status | Meaning |
| ------ | ------- |
| Proposed | Written, not yet agreed |
| Accepted | In effect |
| Deprecated | No longer applies, and nothing replaced it |
| Superseded by NNNN | Replaced by a later record |

Don't rewrite an accepted record when a decision changes.
Write a new record, set the old one's status to "Superseded by" with a link, and keep the rest unchanged.
Editorial improvements, such as clearer wording, typo corrections and link fixes, are fine if they preserve the decision and its reasoning.

## Index

| Number | Decision | Status |
| ------ | -------- | ------ |
| [0000](0000-record-decisions.md) | Record decisions in lightweight decision records | Accepted |
| [0001](0001-start-from-the-webid.md) | Start from the WebID, with the identity provider as a second route | Accepted |
| [0002](0002-build-the-solid-flow-by-hand.md) | Build the Solid flow by hand, not with a Solid login library | Accepted |
| [0003](0003-static-app-for-any-solid-stack.md) | Ship a static app that works with any compliant Solid stack | Accepted |
| [0004](0004-label-how-each-step-is-known.md) | Label how each step is known, and never present explanations as logs | Accepted |
| [0005](0005-redact-secrets-in-one-place.md) | Redact secrets in one place, with fixed rules for each kind of value | Accepted |
| [0006](0006-tour-from-recorded-journeys.md) | Build the tour from recordings of the real steps against fictional servers | Proposed |
| [0007](0007-toolchain.md) | Use solid-oidc's toolchain, with Vale as a required check | Accepted |
| [0008](0008-tokens-in-memory-key-in-indexeddb.md) | Keep tokens in memory, and the DPoP key as a non-extractable key in IndexedDB | Proposed |
| [0009](0009-client-id-documents-only.md) | Identify the app with a Client ID Document only | Proposed |
