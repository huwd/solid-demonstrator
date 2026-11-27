# 0013. Deploy to GitHub Pages from main, in the only workflow that can write

- **Status:** Accepted
- **Decided by:** @huwd
- **Decided:** 2026-11-27
- **Recorded:** 2026-11-27
- **Discussion:** Planning session, 27 November 2026 (no issue)

## Summary

The demonstrator is deployed to GitHub Pages each time `main` changes.
Deploying needs write permissions, so it has its own workflow, separate from CI.
Only its deploy job can write, and only to Pages.
Where the site is served comes from a `SITE_URL` repository variable, not from the code.

## Context

Milestone 1 ends with anyone using the demonstrator on a deployed build.
[Decision 0003](0003-static-app-for-any-solid-stack.md) makes the app static, so any static host works, and says the address of each deployment comes from a `SITE_URL` build setting.
Login, in milestone 2, needs that address too: the Client ID Document names the app's own origin, and identity providers accept token requests only from it.

Until now every workflow has been read-only, with `contents: read` and nothing more.
Publishing to GitHub Pages needs `pages: write`, and `id-token: write` so the deployment can prove which workflow made it.

## Options considered

### GitHub Pages, deployed by its own workflow (chosen)

- The repository is already on GitHub, so there's no new account, service or secret.
- The address is stable, so the Client ID Document has one origin to name.
- The site is served under a path, such as `/solid-demonstrator/`, so the build must know its base path.
- Pages has no preview deployments for pull requests.

### Cloudflare Pages

Preview deployments for each pull request would help review, but each has its own origin, so each would need its own Client ID Document.
It also adds an account and an API token held as a secret.

### Deploy from the CI workflow

Fewer files, but CI runs on every pull request, so write permissions there would sit beside code that hasn't been reviewed yet.

## Decision

`.github/workflows/deploy.yml` builds the app and deploys it to GitHub Pages on every push to `main`, and when run by hand.

- The build job has `contents: read` only. The deploy job alone has `pages: write` and `id-token: write`, and deploys to the `github-pages` environment.
- The build reads `SITE_URL` from a repository variable, and fails if it isn't set. Vite serves the app under the variable's path.
- CI workflows stay read-only. Deploying is the only exception.

## Consequences

- Every change merged to `main` is live within minutes. Checks run before merging, through the ruleset, not before deploying.
- Changing where the site is served means changing `SITE_URL`, and nothing in the code.
- A local build with no `SITE_URL` is served from `/`, as before.
- Moving to another host later means a new deploy workflow and a new `SITE_URL`, and nothing in the app.
