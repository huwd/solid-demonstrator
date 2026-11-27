# Changelog

All notable changes to this project are recorded here, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Before 1.0.0, a minor version bump marks new functionality or a breaking change, and a patch bump marks fixes only.

Each change adds its entry under Unreleased when it merges. No version has been released yet.

## [Unreleased]

### Added

- A start page that explains what a WebID is, with a form to enter one. HTTPS WebIDs are accepted, and HTTP ones only on `localhost`, for local test stacks. A WebID that can't be used is explained beside the form, and nothing is fetched.
- Discovery from the WebID. The app fetches the profile as Turtle, without the part after `#`, and shows the person's name, their Pods and the identity providers the profile names. It then fetches each provider's discovery document, and says whether the provider is ready for login, which features the login needs that it doesn't offer, or why it can't be used.
- Plain explanations of what went wrong, with what to check. For example: a profile that names no identity provider or Pod, a provider whose name differs from the profile's only by a trailing slash, or a server that returned an error.
- A diagnosis when the browser hides why a request failed: a timeout, a server that couldn't be reached, or a response blocked most likely by CORS. Each is labelled as a diagnosis, not a certainty.
- A choice of identity provider and Pod where the profile names more than one. Only providers whose discovery document could be read are offered, and with only one of each, nothing is asked.
- A timeline of every exchange, in order. Each entry shows who talked to whom and why, how the step is known, and whether it went as expected. Opening an entry shows the request, the response, an explanation and the specification. Credentials are hidden or shortened before anything is recorded. Entries that failed or weren't as expected are marked.
- A Client ID Document at `clientid.jsonld` beside the app, which login will use to tell identity providers who the app is. The build writes it from `SITE_URL`, so it names the address the app is served from. It asks for the `webid` scope, and not for refresh tokens, since tokens are kept only in memory.
- The start of login. The app explains what will happen, then sends the person to their provider with a PKCE challenge, `state` and `nonce`. When they come back, it checks the response is to its own request and names the provider they chose, and explains what went wrong if not, such as the person declining. The timeline carries on across the trip, with the redirects reconstructed and the provider's own pages explained.
- Logging in fully. When the person comes back, the app exchanges the code for tokens with the PKCE verifier and a DPoP proof, then shows the WebID they logged in as and when the access token expires. It refuses a token that isn't bound to its key, and explains a refusal from the provider. The token is kept only in memory, so reloading the page means logging in again. The DPoP key is kept in IndexedDB, and its private half can't be exported.
- A token inspector. After login, the app shows what the access token and ID token claim: who issued them, the WebID they name, who they're for, which app they were issued to, when they expire and the key they're bound to. It checks the access token is bound to the app's own key, by its thumbprint. It also repeats the check a Pod makes, fetching the token's WebID and checking the profile names the token's issuer, and says a Pod would refuse the token if not. The tokens themselves are never shown.
- Login with identity providers that don't read Client ID Documents, such as solidcommunity.net. The app registers itself first, with dynamic client registration, and explains the difference: a Client ID Document is a URL the provider can check, while a registered name is only what the app claims. For providers that read the document, the app links to it. A registration is kept for the tab and used again by the next login with that provider, and forgotten if the provider stops recognising it.
- Logging out. The app forgets the session and its tokens, deletes the DPoP key from IndexedDB, removes what it kept in session storage and clears the timeline. It explains that the access token stays valid at the provider until it expires, but can't be used without the deleted key, and that the person may still be logged in at the provider itself.
- The app is published to GitHub Pages from `main`, at the address in the `SITE_URL` repository variable. See [decision 0013](docs/decisions/0013-deploy-to-github-pages.md).

[Unreleased]: https://github.com/huwd/solid-demonstrator/commits/main
