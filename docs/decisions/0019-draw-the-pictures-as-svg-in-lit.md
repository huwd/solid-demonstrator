# 0019. Draw the pictures as SVG in Lit components, with a layout of the app's own

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session for milestone 6, 27 November 2026 (no issue)

## Summary

The map and the timeline's route arrows ([decision 0018](0018-show-the-journey-as-a-map-timeline-and-detail.md)) are SVG, rendered by the Lit components that already make up the interface.
Where each party goes is worked out by a small function of the app's own, in `src/core`, rather than by a diagram or layout library.
Motion uses the browser's Web Animations API.
No dependency is added.

## Context

The interface is built with Lit and bundled by Vite ([decision 0010](0010-lit-and-vite.md)).
Code that runs in Node as well as the browser lives in `src/core`, at full test coverage, and the components are tested in Chromium, Firefox and WebKit with Playwright ([decision 0015](0015-test-against-fictional-and-live-servers.md)).

The pictures are small and their shape is known in advance.
The trace names five kinds of party: the app, WebID profiles, identity providers, Pods and notification services.
A journey has one app and one profile, and a profile names a few identity providers and Pods at most.
What changes during a journey is which parties have been found, and what has passed between them.

The pictures must have a text equivalent, show the provenance of each exchange, and stop moving for people who ask for reduced motion.
The samwho.dev essays, reviewed for decision 0018, draw their live pictures as SVG from Lit components, after moving from a canvas library.

## Options considered

### SVG in Lit components, with the app's own layout (chosen)

- A function in `src/core` turns the trace's entries into the parties found, the exchanges between them, and a position for each. Each kind of party has a place around the app, and parties from the same origin are grouped.
- Lit components render that as SVG, and Playwright tests check what's drawn through its structure and its text, not through screenshots.
- A moving pulse along an exchange's line is a Web Animations API animation, skipped when the browser reports a preference for reduced motion.
- It adds no dependency, and keeps the layout under full test coverage in Node.
- It costs writing the layout, and the arrowheads, curves and labels a library would provide.

### A diagram library, such as Mermaid

- Mermaid draws sequence and flow diagrams from a text description, and is MIT-licensed.
- It lost because it redraws the whole diagram from its text on every change, which suits a finished diagram, not one that grows during a journey. Its layout can move parties around as others appear. It's one of the largest packages the app could carry, at 131 MB unpacked on `npm` for version 12.4.0, and gives little control over the provenance styles and the text equivalent.

### A layout library, such as ELK or `dagre`, with SVG drawn by the app

- ELK and `dagre` place the nodes and route the edges of large graphs.
- They lost because the map has a handful of nodes in places known in advance, so a general layout engine adds weight and unpredictability for no gain. ELK is also licensed under the EPL 2.0 or the GPL 3.0, less permissive than the app's MIT licence.

### D3, or an animation library such as Motion

- D3 offers selections, scales, shapes and transitions. Motion offers spring and timeline animation over the Web Animations API.
- They lost because Lit already renders and updates the SVG, and the pictures need only straight or gently curved lines and a short pulse. D3's own approach to updating the page also overlaps with Lit's.

### A canvas, or a canvas library such as PixiJS

- A canvas draws many moving objects quickly.
- It lost because a canvas has no structure for a screen reader or a test to read, and the pictures never have more than a few dozen objects.

## Decision

The pictures are SVG rendered by Lit components.
Their layout is computed by the app's own code in `src/core`, from the trace.
Motion uses the Web Animations API, and is turned off when the browser reports a preference for reduced motion.
No diagram, layout or animation library is added.

## Consequences

- The layout and the summary of a journey are tested in Node at full coverage, like the rest of `src/core`.
- The browser tests check the pictures through their structure and text, so a change to how they look doesn't fail a test unless it changes what they say.
- Arrowheads, curves and label placement are the app's own code, and must be kept simple.
- If the pictures ever need general graph layout, such as many Pods with links between them, a layout library is worth reconsidering in a new record.
