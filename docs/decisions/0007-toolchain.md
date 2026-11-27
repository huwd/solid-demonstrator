# 0007. Use solid-oidc's toolchain, with Vale as a required check

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

The demonstrator follows [solid-oidc](https://github.com/huwd/solid-oidc)'s conventions and tools: devenv for the toolchain, pnpm, TypeScript, `node:test` with full coverage, Biome, and documentation in plain British English in the GOV.UK style.
One thing differs: Vale prose errors fail the build here, in `devenv test` and in CI, rather than being advice run only locally.

## Context

The demonstrator sits beside solid-oidc and the reference stack's deployment, maintained by the same person with coding agents.
Shared conventions mean one set of habits across the three, and solid-oidc's tooling already exists to copy.

The demonstrator is mostly explanation.
Its documentation and the text the app shows matter as much as its code, so prose quality needs the same weight as linting code.

## Options considered

### solid-oidc's toolchain, with Vale required (chosen)

- devenv provides Node, pnpm, actionlint, shellcheck, zizmor and Vale, with Vale bundled with the house styles and the en_GB dictionary through `nix/vale.nix`.
- `devenv test` is the build: it installs from the lockfile and runs `pnpm run check`.
- CI runs the same scripts, one job per check. The prose job runs Vale through devenv, so CI uses the same styles and dictionary.
- Vale errors, such as spelling and terminology, fail the check. Style warnings remain advice.
- Every project term needs a vocabulary entry before it passes, which adds a little friction to writing.

### solid-oidc's toolchain unchanged, with Vale advisory

Lighter, but prose errors would reach `main`, in a project whose main output is explanation.

### A different toolchain

Front-end projects often use their own test runners and linters.
The demonstrator still needs a bundler for the browser, but using different test and lint tools from solid-oidc would split habits across projects for little gain.

## Decision

The demonstrator uses solid-oidc's conventions and toolchain.
`devenv test` and CI run markdownlint and Vale, and Vale errors fail both.
Biome, TypeScript and `node:test` join `pnpm run check` when the first code arrives.

## Consequences

- The prose CI job installs Nix and devenv, so it is slower than the other jobs.
- Tools from devenv that CI can't take from Dependabot, such as the zizmor version and `devenv.lock`, are bumped by hand, as listed in `.github/dependabot.yml`.
- A front-end build tool and browser tests are new to this set of conventions, and need their own records when chosen.
