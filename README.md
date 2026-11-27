# Solid Demonstrator

A Solid app that runs entirely in the browser and explains itself as it works.
Give it any WebID and it finds that WebID's identity provider and Pod, logs in, then reads and writes data in the Pod.
At each step it shows which party it is talking to, why, and what came back.

It is for developers who know HTTP and OAuth, and want to understand how the parties in Solid fit together.

## Status

Early development. The app is an empty shell; discovery, the first milestone, is in progress.

- [`OUTCOMES.md`](OUTCOMES.md) sets out what the demonstrator must let people do and understand.
- [`PLAN.md`](PLAN.md) describes how to build it, in milestones.
- [`docs/decisions/`](docs/decisions/README.md) records the decisions made so far, and the options that lost.

## Development

Development uses [devenv](https://devenv.sh/) for the toolchain: Node 26, pnpm, Vale, actionlint, jq, shellcheck and zizmor.

```sh
devenv test                  # the build: install, then run every check
devenv shell                 # a shell with the toolchain
pnpm run check               # every check CI runs, inside devenv shell
pnpm run dev                 # the app, served by Vite with reload
pnpm run workflows:audit     # zizmor security audit of the workflows
```

Documentation is written in plain British English in the GOV.UK style.
Vale errors fail the build; add genuine project terms to `.vale/styles/config/vocabularies/House/accept.txt`.

[`.github/rulesets/`](.github/rulesets/README.md) defines the branch protection for `main`, and how to apply it.

## Licence

[MIT](LICENSE).
