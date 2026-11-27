# 0011. Parse profiles as Turtle with n3, and ask for Turtle only

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

The demonstrator asks for WebID profiles, and later Pod resources, as Turtle, and parses them with the `n3` library.
It doesn't handle JSON-LD for now.

## Context

Discovery reads a few statements from the WebID profile, such as `solid:oidcIssuer` and `pim:storage`.
Later milestones show Pod resources as readable statements.
The WebID specification requires every profile to be available as Turtle; some are also served as JSON-LD.
Asking for a format with the `Accept` header, and showing that request, is itself part of what the demonstrator explains.

## Options considered

### `n3`, Turtle only (chosen)

- `n3` is the Turtle parser most Solid apps in JavaScript use, and it runs in Node and the browser.
- Every WebID profile must be available as Turtle, so asking for Turtle reaches every compliant profile.
- A profile served only as JSON-LD, against the specification, fails, and the demonstrator explains why.

### `n3` and `jsonld`

Handles both formats from the start.
`jsonld` is large, and fetches remote contexts by default, which would add requests to disable or trace, for profiles that must offer Turtle anyway.

### A minimal parser of the project's own

Small and readable, but Turtle's prefixes, lists and blank nodes would break it on real profiles.

## Decision

The demonstrator sends `Accept: text/turtle` when it fetches a profile or an RDF resource, and parses the response with `n3`.
A response in another format is treated as a failure of that step, with an explanation.

## Consequences

- Viewing a Pod resource stored as JSON-LD shows it as text, not as statements, until JSON-LD support is added.
- If testing finds real profiles that aren't served as Turtle, a new record should revisit this.
