# 0004. Label how each step is known, and never present explanations as logs

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

Much of a Solid interaction happens where the browser can't see it: at the identity provider during login, and on the Pod's server when it checks a request.
The demonstrator still shows those steps, but labels every entry in its trace with how it knows about it: seen, reconstructed, repeated or explained.
Where the browser can repeat another party's check from public data, the demonstrator does so, rather than only describing it.

## Context

A browser app can observe its own `fetch` requests and their responses.
It can't observe:

- the redirects to and from the identity provider, since the page itself navigates away
- the identity provider's own work, such as fetching the Client ID Document or handing off to an upstream login
- the Pod's checks of each request: the DPoP proof, the WebID profile, the issuer's keys and the access rules

The demonstrator's purpose is to explain how the parties fit together, which is mostly what happens between them.

## Options considered

### Four labels, with repeated checks where possible (chosen)

| Label | Meaning |
| --- | --- |
| Seen | The app made the request and saw the response |
| Reconstructed | The browser was redirected, and the app rebuilt the step from what it sent and what came back |
| Repeated | The app repeated a check another party makes, to show its result |
| Explained | The app can't see this, but it is what the protocol requires |

The Pod's checks of the WebID profile, the issuer and the token's signature use only public data, so the browser repeats them.

- A reader always knows which entries are evidence and which are explanation.
- Repeated checks show real results for the most important step: why the Pod trusted the token.
- Explained entries can drift from what servers do, so each cites the specification it relies on.

### Show only what the browser sees

Accurate, but it leaves out most of what the demonstrator exists to explain.

### Show everything, unlabelled

Easier to read, but it presents explanation as if it were observation, and would mislead a reader debugging their own stack.

## Decision

Every trace entry carries one of the four labels.
Explained entries are drawn from the specifications and from known behaviour of common servers, cite their source, and are never presented as logs.
The demonstrator repeats the Pod's public-data checks in the browser and labels them as repeated.

## Consequences

- The trace, the timeline and the diagram all need to show the label.
- Explained entries need a review when the servers they describe change.
- Failure diagnosis follows the same rule: where the browser hides a cause, as with CORS, the demonstrator labels its answer as a diagnosis.
