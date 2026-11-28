# Outcomes

Solid Demonstrator is a Solid app that runs entirely in the browser and explains itself as it works. A person gives it any WebID. It finds that WebID's identity provider and Pod, logs in, then reads and writes data in the Pod. At each step it shows which party it is talking to, why, and what came back.

This document sets out what the demonstrator must let people do and understand. It describes outcomes, not implementation. [PLAN.md](PLAN.md) describes how to build it.

## Who it is for

The main reader is a developer who knows HTTP, OAuth or OpenID Connect at a working level, and has not used Solid.

They should come away able to say:

- which parties take part in a Solid interaction, and what each one is responsible for
- how an app gets from a WebID to a login and a Pod, without anything being configured in advance
- why the Pod trusts a login it has never seen before
- where access is decided, and why a login alone doesn't grant access to anything
- what an app sends on every request, and why

A second reader is someone who runs their own Solid stack and wants to see their own setup through an app's eyes, including where it refuses something.

## The parties

The demonstrator names these parties consistently, in words, diagrams and traces:

| Party | What it does | Example |
| --- | --- | --- |
| The app | This demonstrator, running in the person's browser | The demonstrator's own origin |
| The WebID profile | A public document that says who the person is, which identity providers may log them in, and where their Pod is | `https://huwdiprose.co.uk/profile` |
| The identity provider | The Solid-OIDC issuer: logs the person in and issues tokens that name their WebID | `https://id.huwdiprose.co.uk` |
| The Pod | Stores data and decides, on each request, who may do what | `https://pod.huwdiprose.co.uk/` |
| The notification service | Tells the app when a resource in the Pod changes | Advertised by the Pod |

An identity provider may hand the login to another service, as `id.huwdiprose.co.uk` hands it to Pocket ID. The app can't see this in general, so the demonstrator explains that it may happen rather than naming a party it can't detect.

The WebID, identity provider and Pod may all be one service, as at most hosted Solid providers, or three separate ones, as in the stack the examples come from. The demonstrator must work and explain itself clearly in both cases.

## Two ways to watch

Every outcome below works in two views, and the person can switch between them at any point without losing their place:

- **Outcome view** shows what the person would see in an ordinary Solid app: who they are logged in as, their Pod, their files.
- **Plumbing view** shows how it happened: a timeline of every exchange, a diagram of the parties, and the detail of each request and response.

## Outcomes

### 1. Start from any WebID

A person can type or paste any WebID and start. Nothing about a particular identity provider or Pod is built in.

- The demonstrator accepts any HTTPS WebID. It accepts HTTP only on a loopback host, for local stacks.
- A person who doesn't know their WebID can start from their identity provider's URL instead. After login, the demonstrator reads the WebID from the token and carries on from the profile, showing that this route reaches the same place.
- The demonstrator explains what a WebID is in one or two sentences on the start page, with no prior Solid knowledge assumed.

### 2. See how the WebID leads to everything else

A person can see the discovery chain, step by step:

1. The WebID is fetched. The fragment (`#me`) is not sent, and the demonstrator says why.
2. The profile is parsed, and the statements that matter are picked out: `solid:oidcIssuer` and `pim:storage`, plus anything else used later.
3. Each identity provider's discovery document is fetched, showing that it supports Solid-OIDC and which ways it accepts for an app to identify itself.

Where the profile offers a choice, the person makes it:

- More than one identity provider: the person picks one, with each provider's name and URL shown.
- More than one Pod: the person picks one, and can switch later.
- None of either: the demonstrator says what is missing and what the profile owner would need to add.

### 3. Log in through their own identity provider

A person can log in with any Solid-OIDC identity provider that accepts a Client ID Document or dynamic client registration.

- The demonstrator identifies itself with a Client ID Document published alongside it, and shows that document.
- Where the identity provider doesn't accept Client ID Documents, the demonstrator registers itself on the fly with dynamic client registration instead, and shows the registration.
- The demonstrator says which method it used and why, and what difference it makes: a Client ID Document is a URL the identity provider can check, while a dynamically registered name is only what the app claims.
- The person consents on their identity provider's own pages. The demonstrator explains, before the person leaves, what will happen there and that the demonstrator can't see it.
- On return, the demonstrator shows what came back and what it checked: the `state` matches, the `iss` matches the chosen identity provider, and the code is exchanged using PKCE and a DPoP proof.
- The demonstrator shows the decoded tokens: who issued them, the WebID they name, who they are for, when they expire, and the key they are bound to.
- The demonstrator checks and shows that the WebID in the token names this identity provider in its profile. This is the check the Pod will make.

### 4. Understand what a login does and doesn't grant

A person can see that logging in proves who they are, and decides nothing about access.

- The demonstrator explains that the consent at the identity provider lets the app act as the person's WebID. It does not grant access to any data.
- When the person first uses their Pod, the demonstrator shows that the Pod decides access on each request, from its own access rules.

### 5. Use their Pod as an ordinary app would

A person can browse and change data in their Pod, much as in a general-purpose Pod browser such as Penny.

- Browse containers and see what is in them.
- View a resource, as text, or as a readable list of statements for Turtle and JSON-LD.
- Create a resource or container, edit a text or Turtle resource, and delete a resource.
- Writes that would overwrite someone else's change are refused, and the demonstrator explains how the Pod detected the conflict.
- Every operation appears in the plumbing view with its method, headers, status and a plain account of its purpose.

### 6. See why the Pod trusted the request

For each request to the Pod, a person can see what the Pod must have done to accept or refuse it, even though it happens on the Pod's server:

1. Check the DPoP proof matches this request's method and URL, and the token's key.
2. Fetch the WebID profile named in the token.
3. Check that the profile names the token's issuer.
4. Fetch the issuer's signing keys and check the token's signature.
5. Check its access rules for this WebID, app and operation.

Where the demonstrator can repeat a check itself, it does, and shows the result. Steps 2, 3 and 4 can be repeated in the browser. Steps it can't repeat are shown as what the Pod is known to do, and marked as such.

### 7. See access refused, and why

A person can see each kind of refusal and understand where it came from:

- No login: `401`, and what the Pod asked for.
- Logged in, but not allowed: `403`, and that the decision came from the Pod's access rules, not the identity provider.
- Where the person has Control access, they can view the access rules for a resource, whether the Pod uses Web Access Control or Access Control Policies.

### 8. Watch notifications arrive

A person can subscribe to changes to a resource or container and watch them arrive.

- The demonstrator shows how it found the notification service, from the Pod's storage description.
- It shows the subscription request, the channel it got back and the connection it opened.
- When a resource changes, from this tab, another tab or another app, the notification appears in both views.
- If the Pod offers no notification service, the demonstrator says so and the rest still works.

### 9. Know how each step is known

Every entry in the plumbing view is labelled with how the demonstrator knows about it:

| Label | Meaning | Example |
| --- | --- | --- |
| Seen | The app made this request and saw the response | Fetching the WebID profile |
| Reconstructed | The browser was redirected and the app rebuilt the step from what it sent and what came back | The trip to the identity provider and back |
| Repeated | The app repeated a check another party makes, to show its result | Checking the token's signature against the issuer's keys |
| Explained | The app can't see this, but it is what the protocol requires | The Pod checking its access rules |

Explained steps are drawn from the specifications and from known behaviour of common servers. They are never presented as logs.

### 10. Find where something failed

When something fails, a person can see where, and what it means:

- The failing step is marked in the timeline and the diagram, with the party that refused.
- The demonstrator says what was expected, what happened, and the likely causes. For example: a profile with no `solid:oidcIssuer`, an identity provider that accepts neither a Client ID Document nor dynamic registration, a response the browser blocked because of CORS, an `iss` that doesn't match, or a `403` from the Pod.
- Where the browser hides the cause, as it does for CORS failures, the demonstrator says so and gives its best diagnosis, labelled as a diagnosis.
- The person can retry from the failed step without starting again, where the protocol allows.

### 11. Share what happened without leaking secrets

A person can show their trace to someone else safely.

- The demonstrator never shows a raw access token, refresh token or token signature.
- Login codes, PKCE values and `state` are shortened when shown.
- DPoP proofs are shown in full, since each is single-use and bound to one request, and seeing one helps explain DPoP.
- The browser's private DPoP key can't be exported, by design.
- A person can export the trace as a file. The same rules apply to the export.

### 12. Leave cleanly

A person can log out and the demonstrator forgets them: tokens, keys and trace are removed from the browser. The demonstrator explains what logging out does and doesn't do at the identity provider.

### 13. Explore without a Solid account

A person with no WebID can still understand the whole journey, and can get an account if they want to try it for real.

- **Take the tour.** The start page opens with a scripted journey through the whole of Solid with no login: discovery, login, reading and writing the Pod, and notifications. It draws them in the same pictures as a live session, and ends with "Try it yourself".
  - The tour follows a fictional person on fictional servers. Its exchanges are examples written from the specifications, and checked against the steps the live app takes, so no real person's data appears.
  - Every part of the tour is clearly labelled as an example, so it can't be mistaken for a live session.
  - The tour shows a failure as well as success, such as a write the Pod refuses.
- **Get an account.** The start page links to at least one public Solid provider where a person can create a WebID and Pod, explains in a sentence what they will get, and says that they can return and start from their new WebID.
- **Try someone else's WebID.** A person can enter any public WebID, such as the one in the examples. Discovery works for anyone. The demonstrator explains that they can't complete the login, because only the WebID's owner can log in as that WebID.

## What it must be

- **Static.** It is a set of files that any static host can serve. It has no server of its own, so no data about the person leaves their browser except to the parties they chose.
- **Faithful.** It speaks the protocols as written, so it works with any compliant WebID host, identity provider and Pod, not only with the stack the examples come from.
- **Readable.** The code for each step is short and named after the step, so a developer can read the demonstrator's source as a second explanation.

## Not in scope

- A production Pod browser. The demonstrator supports enough operations to show the plumbing, not every Solid feature.
- Editing access rules. Viewing them is in scope; a mistake in editing them can lock the owner out of their own Pod.
- Webhook notifications. They need a server to receive them, and the demonstrator has none.

## Open questions

- **Which public providers to recommend.** Outcome 13 links to public providers for sign-up. The choice depends on which ones work well with the demonstrator, which the testing against hosted providers will show.
- **Which hosted providers to test against.** The demonstrator should be checked against at least one hosted provider where the WebID, identity provider and Pod are one service, as well as against the split stack.
