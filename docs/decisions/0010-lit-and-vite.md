# 0010. Build the interface with Lit, bundled by Vite

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

The interface is a set of web components written with Lit, a small library over the browser's own Custom Elements.
Vite bundles the app into static files.
The code splits in two: `src/core` holds the steps, trace and redaction, which run in Node and the browser alike, and `src/app` holds the interface.

## Context

The interface needs a start page, a timeline of trace entries, an inspector, choice pickers, and later a sequence diagram and a Pod browser.
[Decision 0002](0002-build-the-solid-flow-by-hand.md) wants the source to read as a second explanation of the flow, so the less a framework does out of sight, the better.
[Decision 0007](0007-toolchain.md) runs tests in Node with `node:test`, and Node strips TypeScript types itself, which allows only erasable syntax.
The app is static ([decision 0003](0003-static-app-for-any-solid-stack.md)), so it needs a bundler that writes plain files.

## Options considered

### Lit, bundled by Vite (chosen)

- Lit is about 5 KB, has no virtual DOM, and its templates are tagged template strings, so a reader can trace a screen back to the data it shows.
- Components are standard Custom Elements, which outlive any framework.
- Lit's decorators are not erasable syntax, so components declare reactive properties with static fields instead. This is more verbose, and consistent with the rest of the code.
- Vite serves TypeScript directly in development and writes static files for any host, with little configuration.

### Plain TypeScript and the DOM

No interface dependency at all.
The timeline, inspector and diagram would need their own rendering and update code, which risks growing into a small framework of the project's own.

### Preact

React-style components in about 4 KB.
Familiar to many developers, but JSX is not erasable syntax, and the component model adds a layer between the trace and the screen.

## Decision

The interface is written as Lit components in `src/app`, without decorators.
Vite bundles it, from `index.html`, into `dist/`.
Code that must run in Node as well as the browser lives in `src/core`, and never imports from `src/app` or from Lit.

## Consequences

- `src/core` is tested in Node, with full coverage. `src/app` is browser code, tested in a real browser ([decision 0012](0012-playwright-for-browser-tests.md)).
- `tsconfig.json` type-checks both, with the DOM and Node libraries together, so a Node-only API used in `src/core` won't be caught by the type checker. The browser tests catch it instead.
- `pnpm run build` is part of `pnpm run check` and CI, so a change that breaks the bundle fails the build.
