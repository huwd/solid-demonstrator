# solid-demonstrator

A static, browser-only Solid app that explains each exchange as it happens: from a WebID to its identity provider and Pod, through login, to reading, writing and notifications. [`README.md`](README.md) gives the overview, [`OUTCOMES.md`](OUTCOMES.md) what it must do, and [`PLAN.md`](PLAN.md) how it gets there. Milestone 1, discovery, is complete, and milestone 2, login, is in progress. `src/core` holds the trace, redaction and the traced `fetch`, and the discovery steps (`readWebId`, the profile, each identity provider and the `discover` flow), the login steps so far, and the messages that explain what they find. `src/app` holds the Lit views.

## Commands

Run everything inside `devenv shell`, or prefix a command with `devenv shell --`.

| Command | Does |
| ------- | ---- |
| `devenv test` | The build: install from the lockfile, then run `pnpm run check` |
| `pnpm run check` | Everything CI runs: Biome, TypeScript, tests, the Vite build, browser tests, markdownlint and Vale |
| `pnpm run lint` / `typecheck` / `test` / `build` / `test:browser` / `docs:lint` / `docs:prose` | One check each |
| `pnpm run format` | Biome formatting and safe fixes |
| `pnpm run dev` | The app, served by Vite with reload |
| `pnpm run workflows:audit` | zizmor security audit of the workflows, also run in CI |
| `.github/rulesets/apply.sh --dry-run` | Show what applying the rulesets would change |

## Decisions

[`docs/decisions/`](docs/decisions/README.md) holds the decisions this project rests on. Before a significant change, read the accepted records it touches, and check the change against them. A change that conflicts with an accepted record needs a new record that supersedes it, agreed with the maintainer before the change is made. The records most likely to bear on day-to-day work:

- Nothing about a particular WebID host, identity provider or Pod is built in, outside examples and test fixtures ([0003](docs/decisions/0003-static-app-for-any-solid-stack.md)).
- Every trace entry is labelled seen, reconstructed, repeated or explained, and explained entries are never presented as logs ([0004](docs/decisions/0004-label-how-each-step-is-known.md)).
- Only the redaction module decides what is safe to show. No step records a credential it has no redaction rule for ([0005](docs/decisions/0005-redact-secrets-in-one-place.md)).
- Tokens stay in memory only, never in browser storage ([0008](docs/decisions/0008-tokens-in-memory-key-in-indexeddb.md)).

## Conventions

The project follows [solid-oidc](https://github.com/huwd/solid-oidc)'s conventions ([0007](docs/decisions/0007-toolchain.md)).

- Write documentation, and text the app shows, in plain British English in the GOV.UK style. Vale errors fail the build: fix them, and add genuine project terms to `.vale/styles/config/vocabularies/House/accept.txt`. Judge its warnings.
- Pin dependencies exactly. pnpm refuses versions published less than 48 hours ago.
- Follow solid-oidc's [`docs/code-style.md`](https://github.com/huwd/solid-oidc/blob/main/docs/code-style.md) for TypeScript. Write only erasable syntax, since Node strips types to run the tests: Lit components declare properties with static fields, not decorators ([0010](docs/decisions/0010-lit-and-vite.md)).
- Code that runs in Node as well as the browser lives in `src/core`, and never imports from `src/app` or Lit. Keep `src/core` at 100% line, branch and function coverage with `node:test`. `src/app` is tested in Chromium, Firefox and WebKit with Playwright, in `*.spec.ts` files beside the code ([0015](docs/decisions/0015-test-against-fictional-and-live-servers.md)). The browsers come from nixpkgs through devenv, so `@playwright/test` is pinned to `pkgs.playwright-driver.version` and changes only with `devenv update`.
- Steps make requests only through the traced `fetch`, never `fetch` itself, so every exchange is redacted and recorded.
- Keep deployment-specific values, such as real domains, out of the code. They belong in configuration, such as the `SITE_URL` build setting.

## Git

- `main` is protected by the ruleset in [`.github/rulesets/protect_main.json`](.github/rulesets/protect_main.json): changes go through pull requests that are up to date with `main` and pass the CI and Verify pins checks. Merge with a merge commit, so the branch's signed commits survive. Force pushes and deleting `main` are blocked. Change the ruleset by editing that file in a pull request, then apply it as [its README](.github/rulesets/README.md) describes.
- Work on a branch from `main`. Commit as you go, push the branch, and open a draft pull request, without asking. Avoid stacking a branch on another branch that hasn't merged. Never push to `main`, force-push, mark a pull request ready or merge one: those are the maintainer's.
- Every commit that reaches `main` is signed through the maintainer's Bitwarden SSH agent and carries their `Signed-off-by` line. An agent never adds either. Commit with `git -c commit.gpgsign=false commit -F <message file>`, without `-s`, and check each commit passes `devenv test` on its own.
- Write pull request descriptions to the standard in the `pull-requests` skill: what changes and why, a size table of core, mechanical and generated lines, a review estimate at 300 core lines an hour, and a reading order by risk. Propose a split before opening anything over about 800 core lines, or with several independent concerns.
- When a branch is ready for review, the maintainer runs `git sign-off` with `!`. Tell the maintainer when to run it, and keep the pull request's description current with `gh pr edit --body-file` before then. `git sign-off` rewrites the branch's commits, locally and on GitHub. Afterwards, never merge an old copy of those commits back in: rebase onto the rewritten branch, or onto `main` once it has merged. A rebased commit that still carries a `Signed-off-by` line has lost its signature, and `git sign-off` refuses it, so remove the line and let `git sign-off` add it again.
- Write commit subjects as [Conventional Commits](https://www.conventionalcommits.org/), such as `docs: add a README`, of at most 50 characters.
- Attribute AI help with trailers, in this order, following the [laptop repository's record 0016](https://huwd.github.io/declarative_laptop/decisions/0016-ai-attribution-trailers/):

  ```text
  Generated-by: Claude Code:<model-id>
  Co-Authored-By: <model name> <noreply@anthropic.com>
  Signed-off-by: (added by git sign-off)
  ```

  Use `Generated-by` when the agent produced most of the change from prompts, and `Assisted-by` when the maintainer did most of the work. Say which you chose when committing.
- CI workflows stay read-only. The one exception is the deploy job in `deploy.yml`, which publishes `main` to GitHub Pages ([0013](docs/decisions/0013-deploy-to-github-pages.md)). Run `gh actions-lock` after changing any `uses:` line.
