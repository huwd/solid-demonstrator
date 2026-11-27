# 0001. Start from the WebID, with the identity provider as a second route

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

A journey starts from the person's WebID.
The demonstrator reads the profile to find the identity providers and Pods it names, and asks the person to choose where the profile offers more than one.
A person who doesn't know their WebID can start from their identity provider instead, and the demonstrator carries on from the WebID in the token.

## Context

A Solid app can start a login from a WebID or from an identity provider's URL.
Most Solid apps ask for the identity provider, because that is what people with hosted accounts know.

The demonstrator exists to show how the parties fit together.
In Solid, the WebID profile is where trust starts: a Pod accepts a token only if the WebID profile it names lists the token's issuer as a `solid:oidcIssuer`.
The reference stack makes this visible, with the WebID at `huwdiprose.co.uk`, the identity provider at `id.huwdiprose.co.uk` and the Pod at `pod.huwdiprose.co.uk`, and nothing in the Pod's configuration naming the identity provider.

## Options considered

### WebID first, identity provider as a second route (chosen)

- The discovery chain from WebID to identity provider and Pod is the first thing a person sees, which is the point the demonstrator most needs to make.
- The check a Pod makes, that the profile names the token's issuer, can be shown against the profile the person started from.
- People with hosted accounts who know only their provider can still start, and see that the second route arrives at the same profile.
- Profiles can name several identity providers or Pods, so the demonstrator needs a way to choose between them.

### WebID only

Simpler, but turns away people who don't know their WebID, as is common for people with hosted accounts.

### Identity provider first, as most Solid apps do

Matches what people are used to, but hides the profile's role until after login, and makes the trust chain look as if it starts at the identity provider.

## Decision

The start page asks for a WebID.
A secondary route accepts an identity provider's URL and, after login, continues from the `webid` claim in the token.
Where the profile names more than one identity provider or Pod, the person chooses, and can change the Pod later.

## Consequences

- Discovery is the first milestone, and needs test profiles with one, several and no identity providers or Pods.
- A WebID profile the browser can't read, for example because of CORS, stops the main route at its first step, so the demonstrator has to explain that failure well.
- Nothing about a particular identity provider or Pod is built in. See [0003](0003-static-app-for-any-solid-stack.md).
