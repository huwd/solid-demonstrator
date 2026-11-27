# 0017. Write to a scratch folder by default, and show how to narrow the app's access

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session for milestone 4, 27 November 2026, and [#33](https://github.com/huwd/solid-demonstrator/issues/33)

## Summary

Milestone 4 lets the demonstrator create, edit and delete data in a person's Pod.
Logging in doesn't limit what it can change: the app can do whatever the person's WebID may do, which for the Pod's owner is everything.
The demonstrator therefore writes into a folder of its own, `solid-demonstrator/` in the chosen storage, unless the person chooses to change something elsewhere.
It also shows how to narrow its access in the Pod's own rules, under ACP or WAC, without editing those rules itself.

## Context

The demonstrator requests only the scopes `openid webid`.
Solid-OIDC has nothing narrower, so approving the app at the identity provider grants no access to data and limits none.
The Pod decides each request from its access rules (outcome 4).
Unless those rules name the app, the app has the WebID's full access.

Outcome 5 asks for creating, editing and deleting, much as a general-purpose Pod browser does.
The demonstrator is also a teaching tool that people try out on their real Pods, often as the owner.
A mistaken click, or a bug, could then delete or overwrite something that matters.

Both access control systems can limit an app.
In ACP, a matcher can require both the person's WebID (`acp:agent`) and the app's client identifier (`acp:client`).
In WAC, an authorisation can be limited to the app's origin with `acl:origin`.
Not every server is known to enforce `acl:origin`, and an app registered dynamically has no stable client identifier for ACP to name ([decision 0009](0009-client-id-documents-with-registration-fallback.md)).
Editing access rules is out of scope, since a mistake can lock the owner out of their own Pod.

## Options considered

### A scratch folder by default, with an explicit choice to go elsewhere (chosen)

- The demonstrator creates `solid-demonstrator/` in the chosen storage, says that it did, and writes there by default.
- Changing anything outside it needs the person to turn that on for the session. Every delete asks for confirmation, wherever it is.
- It still meets outcome 5, since a person can edit any resource they choose.
- It costs one more container in the Pod, and a switch in the page.

### Write anywhere the person may, like a Pod browser

- The simplest, and closest to outcome 5's comparison with general-purpose Pod browsers.
- It lost because the demonstrator invites people to try it on real Pods. One mistake there costs more than the convenience is worth.

### Write only in the scratch folder

- The safest.
- It lost because outcome 5 includes editing a person's own resources, and conflicts with someone else's change are most realistic on existing data.

## Decision

The demonstrator writes into `solid-demonstrator/` in the storage the person chose, creating it if it isn't there, without overwriting anything already at that address.
Creating, editing or deleting anything outside that folder needs the person to allow it for the session; it's off after each login.
Every delete asks for confirmation first.

The demonstrator also explains how to narrow its access where access is decided.
It shows the token's `client_id`, and example rules, under ACP or WAC, that let only this app, as this person, read and write the scratch folder.
The person applies them in the Pod; the demonstrator never edits access rules.
Where the app has no stable client identifier, because it was registered dynamically, it says that ACP can't name it.

## Consequences

- Every login can leave a `solid-demonstrator/` container in the person's Pod. The page says so, and the person can delete it.
- The switch for changes outside the scratch folder is the demonstrator's own safeguard, not the Pod's. The page must say that the Pod would allow those changes anyway, unless its rules say otherwise.
- After the person narrows the app's access, a change outside the scratch folder is refused with a `403`, although the login looks just the same. That shows outcome 4 in practice.
- Example rules for ACP need the deployed app's Client ID Document URL, which comes from `SITE_URL`, not from code.
- Whether servers enforce `acl:origin` needs checking against live ones before the WAC example says it will work.
