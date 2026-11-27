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

If you don't have a WebID, you can use anyone's, since profiles are public.

If it's your WebID, you can then log in through your identity provider. The demonstrator then shows:

- what the tokens say, and whether a Pod would accept them, by repeating the Pod's checks
- your Pod, a folder at a time, with what you may do in each, and the files in it
- what your Pod offers, such as notifications, from its storage description
- the access rules for a folder or file, if you have Control access, whether the Pod uses Web Access Control or Access Control Policies

Writing to the Pod and notifications come in later milestones.

### What happens to your data

The demonstrator runs entirely in your browser. It sends requests straight from your browser to the servers your WebID names, and to no one else.

While you're at your identity provider logging in, the demonstrator keeps the one-time secrets for the login, and its timeline, in your browser's session storage, for that tab only. It removes the secrets as soon as you come back. If it had to register with your identity provider, it also keeps the `client_id` it was given there for that tab, so logging in again doesn't register again.

Once you're logged in, the access token is kept only in the page's memory, so it's gone when you reload or close the page. The key that the token is bound to is kept in your browser's IndexedDB for this site, so the next login can use it again. The browser won't let anyone export its private half, not even the demonstrator.

Logging out removes all of this: the token, the key, what's in session storage and the timeline. You may still be logged in at your identity provider itself, since that's its own site.

Your browser only lets the demonstrator read a server's response if the server allows requests from other sites, using CORS. Solid servers are expected to. If one doesn't, the demonstrator says so.

## Status

Discovery, login and reading the Pod, milestones 1 to 3, are complete. Writing to the Pod, milestone 4, is next. [`CHANGELOG.md`](CHANGELOG.md) lists what has changed.

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
