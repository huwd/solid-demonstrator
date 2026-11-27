# Solid Demonstrator

A Solid app that runs entirely in the browser and explains itself as it works.
Give it any WebID and it finds that WebID's identity provider and Pod, logs in, then reads and writes data in the Pod.
At each step it shows which party it is talking to, why, and what came back.

It is for developers who know HTTP and OAuth, and want to understand how the parties in Solid fit together.

## Using it

The demonstrator is published at <https://huwd.github.io/solid-demonstrator/>.

Enter a WebID, such as `https://alice.example/profile#me`, and select **Discover**. The demonstrator then shows:

- what the WebID's profile says: the person's name, their Pods, and the identity providers trusted to log them in
- whether each identity provider is ready for login, and if not, why
- a timeline of every request it made, which you can open to see what was sent and what came back

If you don't have a WebID, you can use anyone's, since profiles are public. Logging in, and reading and writing a Pod, come in later milestones.

### What happens to your data

The demonstrator runs entirely in your browser. It sends requests straight from your browser to the servers your WebID names, and to no one else. It keeps nothing once you close the page.

Your browser only lets the demonstrator read a server's response if the server allows requests from other sites, using CORS. Solid servers are expected to. If one doesn't, the demonstrator says so.

## Status

Milestone 1, discovery, is nearly complete. [`CHANGELOG.md`](CHANGELOG.md) lists what has changed.

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

Each change that people using the demonstrator would notice adds an entry under Unreleased in [`CHANGELOG.md`](CHANGELOG.md).

Merging to `main` publishes the app to GitHub Pages, at the address in the `SITE_URL` repository variable ([decision 0013](docs/decisions/0013-deploy-to-github-pages.md)). A build without `SITE_URL` is served from `/`.

## Licence

[MIT](LICENSE).
