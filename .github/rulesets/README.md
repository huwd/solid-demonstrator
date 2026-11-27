# Rulesets

The repository rulesets, defined as JSON so that changes to them go through review.
The approach follows [solid-oidc](https://github.com/huwd/solid-oidc/tree/main/.github/rulesets), with a script to apply them.

GitHub doesn't apply these files by itself.
After a change merges, a maintainer applies it with [`apply.sh`](apply.sh).

## What `protect_main.json` enforces

- `main` can't be deleted or force-pushed.
- Commits must be signed.
- Changes arrive through a pull request, merged with a merge commit.
  Squash and rebase merges aren't allowed, because they break commit signatures.
- No approving review is required, because the repository has one maintainer.
- These CI jobs must pass, and the branch must be up to date with `main` before merging:
  - from the CI workflow: `Lint`, `Typecheck`, `Test`, `Build`, `Browser tests`, `Docs lint`, `Docs prose` and `Workflow audit`
  - from the Verify pins workflow: `Verify lockfile` and `Verify SHA pins`

  Each check is tied to the GitHub Actions app, so another app can't report a pass.
  Add a new job here only after it has reported on `main`, since a required check that never reports blocks every merge.

## Applying a change

The API calls need administration access to the repository, so CI doesn't make them.
Either use the GitHub CLI, signed in as a repository administrator, or a fine-grained personal access token limited to this repository, with:

- read access to metadata
- read and write access to administration

From the repository root, inside `devenv shell`, which provides `jq`:

```sh
.github/rulesets/apply.sh --dry-run
.github/rulesets/apply.sh
```

For each JSON file, the script finds the ruleset with the same `name`, and updates it, or creates it if there is none.
It refuses to apply a ruleset whose required checks haven't all reported on the default branch's latest commit, and says which are missing.

Afterwards, compare the result in the repository's settings under Rules.
