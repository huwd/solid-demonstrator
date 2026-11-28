# 0018. Show the journey as a map, a sequence timeline and a detail panel

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session for milestone 6, 27 November 2026 (no issue)

## Summary

The plumbing view shows the journey in three linked views, all drawn from the same trace entries:

- a map of the parties, which appear as they're discovered
- a sequence timeline, oldest first, grouped into chapters
- a detail panel for the selected entry

One cursor, the selected step, drives all three, so stepping back through a journey moves every view together.

## Context

Milestone 6 in [PLAN.md](../../PLAN.md) draws the plumbing view as pictures: the parties and the flow to expect, a live diagram of the parties, a plain account of what happened, and a sequence diagram from the trace.
Until now, the plumbing view has been a list of trace entries, each opening to its request and response.

The published descriptions of Solid offer no diagram to follow.
The Solid Protocol has no figures, and defers authentication, authorisation and notifications to their own specifications.
The Solid Project and the Open Data Institute describe Solid in words, as a rucksack with pockets that apps may open only with permission, and as a file system for the web.

Interactive explainers of other protocols were reviewed:

- the Centauri Systems OAuth visualiser draws a sequence diagram of numbered messages, with "Step 1 of 9" and a detail panel for each step
- The Illustrated TLS 1.3 Connection explains each message, then shows its bytes, then annotates each field
- samwho.dev's load-balancing essay introduces each live picture with what to watch for

All three show a scripted scenario.
The demonstrator shows real exchanges, whose number varies, and which retry, fail and branch.

Two government timeline components were reviewed for the plain account:

- the Ministry of Justice timeline gives each item a short title, a byline saying who acted, a time, and a short description, and allows the detail to expand within the item
- the Department for Work and Pensions timeline keeps each item brief, puts the detail elsewhere, and notes that some people expect the oldest entry first

## Options considered

### A map, a sequence timeline and a detail panel (chosen)

- **The map** places the app at the centre, and each party as it's discovered: the WebID profile, then the identity providers and Pods it names, then the notification service.
  - Before login, the flow to expect is drawn faint, and fills in as each exchange is seen.
  - Parties served from the same origin are drawn inside one box, so a single service and a split stack, such as a broker with a separate Pod, look different.
  - The line for an exchange follows its provenance ([decision 0004](0004-label-how-each-step-is-known.md)). A seen exchange is solid, a reconstructed one dashed, and a repeated check a loop on the app. An explained step is a note, never a line, so it never looks observed.
- **The sequence timeline** replaces the list of entries. Each item follows the Ministry of Justice pattern:
  - a title in plain words, from the purpose recorded with the entry
  - a byline giving the route, such as "This app → Pod", drawn as an arrow across a narrow column for each party, and as text on a small screen
  - its time, provenance and verdict

  Items are grouped into chapters, such as discovery and login, each opening with a sentence on what happened in it. This is the plain account the plan asks for.
- **The detail panel** shows the request and response of the selected entry, as the Department for Work and Pensions advises, keeping the timeline brief. Each header and field is annotated with what it means, as The Illustrated TLS 1.3 Connection does. The panel sits beside the timeline, or below it on a small screen.
- **One cursor** selects a step, and highlights it in all three views. In a live session it follows the latest entry. "Step 9 of 31", with buttons for the previous and next steps, lets someone step back through any journey, live or the tour's ([decision 0020](0020-introduce-solid-with-a-scripted-journey.md)).

It covers each picture the plan asks for, keeps the timeline as the text equivalent of the pictures, and handles a journey of any length or shape.
It costs three components that must stay in step, which the shared cursor and shared trace make possible.

### A full sequence diagram

- Lifelines for each party across the page, with an arrow for each exchange, and the detail on selection.
- It's precise, and familiar to anyone who reads protocol specifications.
- It lost because a real journey has dozens of exchanges, so the diagram runs to many screens. It's cramped on a small screen, and it can't show parties being discovered.

### An animated map only, above the current list

- Parties with exchanges moving between them, as in samwho.dev's essays, and the current list below, unchanged.
- It's vivid, and the least work.
- It lost because the order of exchanges, and their retries and failures, would show only in the list, and a moving picture alone is the hardest view to follow with a screen reader.

## Decision

The plumbing view shows the journey as a map of the parties, a sequence timeline and a detail panel, drawn from the same trace and driven by one cursor.

The timeline reads oldest first, since the journey is a story read in order.
New entries arrive at the bottom, and the view follows them unless the person has scrolled away.

The timeline is the text equivalent of the pictures: an ordered list a screen reader can follow.
The map also says in words which parties have been found.
Colour never carries meaning alone, and motion shows only what moved between parties, turned off for people who ask for reduced motion.

## Consequences

- The provenance labels gain a visual form, a line style, which every picture must use the same way.
- Chapters need a mapping from steps to stages of the journey, kept in `src/core` with the messages.
- The Ministry of Justice timeline shows newest first, so the demonstrator's order differs from it. If people find the oldest-first order hard to follow, it's worth revisiting.
- The tour can use the same views, and the cursor, without a separate build.
- How the pictures are drawn is a separate decision, [0019](0019-draw-the-pictures-as-svg-in-lit.md).
