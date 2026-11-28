import { css, html, LitElement, nothing } from "lit";
import { type Choice, choose, initialChoice } from "../core/choice.ts";
import { clientIdDocumentPath, clientMetadata } from "../core/client-id.ts";
import { type DiscoveryResult, discover } from "../core/discovery.ts";
import type { IssuerConfiguration } from "../core/issuer.ts";
import { generateDpopKeyPair, type PendingLogin, prepareLogin } from "../core/login.ts";
import { isLoginReturn, returnFromLogin } from "../core/login-return.ts";
import {
  forgetLogins,
  forgetRegistration,
  recallRegistration,
  rememberRegistration,
  type SavedLogin,
  saveLogin,
  takeLogin,
} from "../core/login-storage.ts";
import {
  describeExchangeProblem,
  describeRegistrationProblem,
  describeReturnProblem,
  describeWebIdProblem,
  type Message,
} from "../core/messages.ts";
import { createPodFetch, type PodFetch } from "../core/pod-fetch.ts";
import { checkPodTrust, type PodTrustResult } from "../core/pod-trust-check.ts";
import { recordReusedRegistration, registerClient } from "../core/registration.ts";
import { exchangeCode, type Session } from "../core/token-exchange.ts";
import { type Inspection, inspectSession } from "../core/token-inspection.ts";
import { checkTokenWebId, type WebIdCheckResult } from "../core/token-webid-check.ts";
import { createTrace, type Trace } from "../core/trace.ts";
import { createTracedFetch, type TracedFetch } from "../core/traced-fetch.ts";
import type { ChooseEvent } from "./discovery-results.ts";
import { deleteDpopKeyPair, loadDpopKeyPair, saveDpopKeyPair } from "./dpop-key-store.ts";
import "./discovery-results.ts";
import "./pod-browser.ts";
import "./token-inspector.ts";
import "./trace-timeline.ts";

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly typed: string }
  | {
      readonly kind: "done";
      readonly result: DiscoveryResult;
      readonly choice: Choice;
      /** Why the app couldn't send the person to log in, if it couldn't. */
      readonly loginProblem: Message | null;
      /** True while the app registers with the provider, before sending the person there. */
      readonly registering: boolean;
    }
  | { readonly kind: "leaving"; readonly issuer: string }
  | { readonly kind: "exchanging"; readonly issuer: string }
  /** Logged in. The session, and its token, are held only here, in memory (decision 0008). */
  | {
      readonly kind: "logged-in";
      readonly session: Session;
      /** Null until the tokens have been read. */
      readonly inspection: Inspection | null;
      /** Null while the Pod's check is being repeated. */
      readonly webIdCheck: WebIdCheckResult | null;
      /** The repeat of the Pod's checks of the token and proof; null while it runs. */
      readonly podTrust: PodTrustResult | "no-pod" | null;
      /** Makes requests to the Pod as this person, with a fresh DPoP proof each time. */
      readonly podFetch: PodFetch;
      /** The Pod chosen before login; null if the profile named none. */
      readonly storage: URL | null;
    }
  | { readonly kind: "login-failed"; readonly message: Message }
  /** Logged out: everything is forgotten except what's needed to explain it. */
  | { readonly kind: "logged-out"; readonly issuer: string; readonly expiresAt: Date | null }
  /** A login response arrived, but this tab started no login. */
  | { readonly kind: "unexpected-return" };

/**
 * The demonstrator's root element: the start page's introduction, the
 * WebID form, what discovery finds, and login. The Pod views arrive in
 * later milestones (see PLAN.md).
 */
export class DemonstratorApp extends LitElement {
  static override properties = { state: { state: true } };

  declare state: State;

  static override styles = css`
    :host {
      display: block;
      max-width: 80rem;
      margin: 0 auto;
      padding: 2rem 1rem;
      font-family: system-ui, sans-serif;
      line-height: 1.5;
      color: CanvasText;
    }
    /* Prose keeps a reading measure; the plumbing view takes the full width. */
    main > :not(.plumbing) {
      max-width: 44rem;
    }
    label {
      display: block;
      font-weight: bold;
    }
    .hint {
      margin: 0 0 0.5rem;
      color: GrayText;
    }
    .error {
      margin: 0 0 0.5rem;
      font-weight: bold;
      color: light-dark(#b00020, #ff8a80);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    input {
      flex: 1 1 20rem;
      font: inherit;
      padding: 0.4rem;
    }
    button {
      font: inherit;
      padding: 0.4rem 1rem;
    }
    .problem,
    .ready {
      border-left: 0.3rem solid;
      padding: 0.25rem 0 0.25rem 1rem;
      margin: 0.75rem 0;
    }
    .problem {
      border-color: light-dark(#b00020, #ff8a80);
    }
    .ready {
      border-color: light-dark(#00703c, #69f0ae);
    }
    .summary {
      font-weight: bold;
      margin: 0;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `;

  /**
   * One trace for the tab's whole journey. It's carried across the trip to
   * the identity provider in session storage (decision 0008).
   */
  readonly #trace: Trace;

  readonly #tracedFetch: TracedFetch;

  constructor() {
    super();
    const here = new URL(location.href);
    const returning = isLoginReturn(here);
    const saved = returning ? takeSavedLogin() : null;
    this.#trace = createTrace({
      now: () => new Date(),
      entriesMax: 500,
      ...(saved === null ? {} : { restored: saved.entries }),
    });
    this.#tracedFetch = createTracedFetch({
      fetch: (input, init) => globalThis.fetch(input, init),
      trace: this.#trace,
      timeoutMs: 15_000,
      recordedTextMax: 100_000,
    });
    if (!returning) {
      this.state = { kind: "idle" };
      return;
    }
    // The code can be used only once, so a reload shouldn't offer it again.
    history.replaceState(null, "", here.pathname);
    if (saved === null) {
      this.state = { kind: "unexpected-return" };
      return;
    }
    const { pending } = saved;
    const result = returnFromLogin(pending, here, this.#trace);
    if (!result.ok) {
      if (result.problem.kind === "refused") {
        forgetRejectedClient(pending, result.problem.error);
      }
      this.state = {
        kind: "login-failed",
        message: describeReturnProblem(result.problem, pending.issuer),
      };
      return;
    }
    this.state = { kind: "exchanging", issuer: pending.issuer };
    void this.#exchange(pending, result.parameters, URL.parse(saved.storage ?? ""));
  }

  async #exchange(
    pending: PendingLogin,
    callback: URLSearchParams,
    storage: URL | null,
  ): Promise<void> {
    const result = await exchangeCode(
      this.#tracedFetch,
      pending,
      callback,
      await dpopKeyPair(),
      this.#trace,
    );
    if (!result.ok) {
      if (result.problem.kind === "refused") {
        forgetRejectedClient(pending, result.problem.error);
      }
      this.state = {
        kind: "login-failed",
        message: describeExchangeProblem(result.problem, pending.issuer),
      };
      return;
    }
    const { session } = result;
    const loggedIn = {
      kind: "logged-in",
      session,
      podFetch: createPodFetch(this.#tracedFetch, session, this.#trace),
      storage,
    } as const;
    this.state = { ...loggedIn, inspection: null, webIdCheck: null, podTrust: null };
    const inspection = await inspectSession(session);
    this.state = { ...loggedIn, inspection, webIdCheck: null, podTrust: null };
    // The Pod reads the access token, so the check uses what it says, where it can be read.
    const webIdCheck = await checkTokenWebId(
      this.#tracedFetch,
      {
        issuer: inspection.accessToken?.issuer ?? session.issuer,
        webId: inspection.accessToken?.webId ?? session.webId,
      },
      this.#trace,
    );
    this.state = { ...loggedIn, inspection, webIdCheck, podTrust: null };
    const podTrust =
      storage === null
        ? "no-pod"
        : await checkPodTrust(
            this.#tracedFetch,
            { ...session, issuer: inspection.accessToken?.issuer ?? session.issuer },
            storage,
            this.#trace,
          );
    this.state = { ...loggedIn, inspection, webIdCheck, podTrust };
  }

  override render() {
    const state = this.state;
    const webIdProblem =
      state.kind === "done" && !state.result.ok && state.result.stage === "webid"
        ? describeWebIdProblem(state.result.problem)
        : null;
    return html`
      <main>
        <h1>Solid Demonstrator</h1>
        <p>
          A WebID is a URL that names a person. Fetching it gives a profile that says which
          services may log them in, and where their data is kept.
        </p>
        <p>This demonstrator follows a WebID through each step of a Solid app, and shows every exchange as it happens.</p>

        <form @submit=${this.#submit} novalidate>
          <label for="webid">WebID</label>
          <p class="hint" id="webid-hint">For example, https://alice.example/profile#me</p>
          ${
            webIdProblem === null
              ? nothing
              : html`<p class="error" id="webid-error">
                  <span class="visually-hidden">Error:</span> ${webIdProblem.summary}. ${webIdProblem.detail}
                </p>`
          }
          <div class="row">
            <input
              id="webid"
              name="webid"
              type="text"
              inputmode="url"
              autocomplete="off"
              spellcheck="false"
              aria-describedby=${webIdProblem === null ? "webid-hint" : "webid-hint webid-error"}
              aria-invalid=${webIdProblem === null ? "false" : "true"}
            />
            <button type="submit" ?disabled=${state.kind === "running"}>Discover</button>
          </div>
        </form>

        <p role="status">${state.kind === "running" ? `Looking up ${state.typed}…` : ""}</p>
        ${
          state.kind === "done"
            ? html`<discovery-results
                .result=${state.result}
                .choice=${state.choice}
                @choose=${this.#choose}
              ></discovery-results>
              ${this.#renderLogin(state)}`
            : nothing
        }
        ${this.#renderReturn(state)}

        ${
          state.kind === "idle" || state.kind === "logged-out"
            ? nothing
            : html`
              <h2>Every exchange so far</h2>
              <p>
                Each request the app made, in order. Choose one to see what was sent and what came
                back. Secrets are hidden or shortened before anything is recorded.
              </p>
              <section class="plumbing" aria-label="Every exchange so far">
                <trace-timeline .trace=${this.#trace}></trace-timeline>
              </section>
            `
        }
      </main>
    `;
  }

  readonly #submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (this.state.kind === "running") {
      return;
    }
    const typed = String(new FormData(event.target as HTMLFormElement).get("webid") ?? "");
    this.state = { kind: "running", typed };
    const result = await discover(typed, { tracedFetch: this.#tracedFetch, trace: this.#trace });
    this.state = {
      kind: "done",
      result,
      choice: result.ok ? initialChoice(result) : { issuer: null, storage: null },
      loginProblem: null,
      registering: false,
    };
  };

  #renderLogin(state: State & { kind: "done" }) {
    const configuration = chosenConfiguration(state);
    if (configuration === null) {
      return nothing;
    }
    const site = siteUrl();
    const document = new URL(clientIdDocumentPath, site);
    return html`
      <h2>Log in</h2>
      ${
        configuration.clientIdDocuments || configuration.registrationEndpoint === null
          ? html`<p>
              The app will identify itself with its
              <a href=${document.href}>Client ID Document</a>, published beside it at
              ${document.href}. ${configuration.issuer} fetches the document itself, so it can check
              the app is served from where it says, and sends you back only to an address the
              document lists.
              ${
                configuration.clientIdDocuments
                  ? nothing
                  : html`${configuration.issuer} doesn't say it reads Client ID Documents or offers
                    registration, so the app will try its document anyway.`
              }
            </p>`
          : html`<p>
              ${configuration.issuer} doesn't read Client ID Documents, so the app will first
              register itself, with dynamic client registration, and be given a client_id. The
              provider can't check what a registration says, since any page could send the same
              request, so a registered name is only what the app claims.
            </p>`
      }
      <p>
        The app will send you to ${configuration.issuer} to log in. The app can't see what happens
        there: the provider checks who you are, then asks whether to let the app act for you. Either
        way, it sends you back here, and the app checks what it says.
      </p>
      ${
        state.loginProblem === null
          ? nothing
          : html`<div class="problem" role="alert">
              <p class="summary">${state.loginProblem.summary}</p>
              <p>${state.loginProblem.detail}</p>
            </div>`
      }
      <button
        type="button"
        ?disabled=${state.registering}
        @click=${() => this.#logIn(state, configuration)}
      >
        Log in with ${configuration.issuer}
      </button>
      <p role="status">${state.registering ? `Registering with ${configuration.issuer}…` : ""}</p>
    `;
  }

  #renderReturn(state: State) {
    switch (state.kind) {
      case "leaving":
        return html`<p role="status">Sending you to ${state.issuer}…</p>`;
      case "unexpected-return":
        return html`<div class="problem" role="alert">
          <p class="summary">No login was started in this tab</p>
          <p>
            This page was opened with a response from an identity provider, but this tab has no login
            to check it against, so the app won't use it. Enter a WebID to start again.
          </p>
        </div>`;
      case "exchanging":
        return html`<p role="status">Back from ${state.issuer}. Exchanging the code for tokens…</p>`;
      case "logged-out":
        return html`<div class="ready" role="status">
          <p class="summary">Logged out</p>
          <p>
            The app has forgotten you. The access token was only in this page's memory, and is gone.
            ${
              state.expiresAt === null
                ? "It stays valid at the provider until it expires,"
                : `It stays valid at the provider until ${state.expiresAt.toLocaleTimeString("en-GB")},`
            }
            but it's bound to a key the app has now deleted, so nobody can use it. The timeline, the
            login's values in session storage and any registration have gone too.
          </p>
          <p>
            You may still be logged in at ${state.issuer} itself, so logging in again may not ask for
            your password. To end that too, log out on ${state.issuer}'s own site.
          </p>
        </div>`;
      case "login-failed":
        return html`<div class="problem" role="alert">
          <p class="summary">${state.message.summary}</p>
          <p>${state.message.detail}</p>
        </div>`;
      case "logged-in": {
        const { session } = state;
        return html`<div class="ready">
          <p class="summary">
            ${session.webId === null ? "Logged in, but the ID token names no WebID" : `Logged in as ${session.webId}`}
          </p>
          <p>
            ${session.issuer} gave the app an access token bound to its DPoP key${
              session.expiresAt === null
                ? ""
                : `, which expires at ${session.expiresAt.toLocaleTimeString("en-GB")}`
            }. The token is kept only in this page's memory, so reloading the page means logging in
            again.
          </p>
        </div>
        <token-inspector
          .inspection=${state.inspection}
          .webIdCheck=${state.webIdCheck}
          .podTrust=${state.podTrust}
          .issuer=${state.inspection?.accessToken?.issuer ?? session.issuer}
          .webId=${state.inspection?.accessToken?.webId ?? session.webId}
        ></token-inspector>
        <pod-browser
          .podFetch=${state.podFetch}
          .trace=${this.#trace}
          .root=${state.storage}
          .webId=${state.inspection?.accessToken?.webId ?? session.webId}
          .clientId=${state.inspection?.accessToken?.clientId ?? null}
        ></pod-browser>
        <h2>Log out</h2>
        <p>
          Logging out makes the app forget you: the tokens, the key they're bound to, what it kept
          for the login, and every exchange in the timeline.
        </p>
        <button type="button" @click=${() => this.#logOut(session)}>Log out</button>`;
      }
      default:
        return nothing;
    }
  }

  async #logOut(session: Session): Promise<void> {
    this.state = { kind: "logged-out", issuer: session.issuer, expiresAt: session.expiresAt };
    this.#trace.clear();
    try {
      forgetLogins(sessionStorage);
    } catch {
      // Storage is blocked, so nothing was kept there.
    }
    try {
      await deleteDpopKeyPair();
    } catch {
      // IndexedDB is blocked, so the key was never kept.
    }
  }

  async #logIn(state: State & { kind: "done" }, configuration: IssuerConfiguration): Promise<void> {
    const site = siteUrl();
    let clientId = new URL(clientIdDocumentPath, site).href;
    const registered = recalledRegistration(configuration.issuer, site.href);
    if (!configuration.clientIdDocuments && registered !== null) {
      recordReusedRegistration(this.#trace, configuration.issuer, registered);
      clientId = registered;
    } else if (!configuration.clientIdDocuments && configuration.registrationEndpoint !== null) {
      this.state = { ...state, loginProblem: null, registering: true };
      const registration = await registerClient(
        this.#tracedFetch,
        configuration.registrationEndpoint,
        clientMetadata(site),
        this.#trace,
      );
      if (!registration.ok) {
        this.state = {
          ...state,
          registering: false,
          loginProblem: describeRegistrationProblem(registration.problem, configuration.issuer),
        };
        return;
      }
      clientId = registration.clientId;
      try {
        rememberRegistration(sessionStorage, configuration.issuer, site.href, clientId);
      } catch {
        // Storage is blocked: the next login registers again.
      }
    }
    const prepared = await prepareLogin(configuration, { clientId, redirectUri: site.href });
    const saved: SavedLogin = {
      pending: prepared.pending,
      entries: this.#trace.entries(),
      storage: state.choice.storage,
    };
    try {
      saveLogin(sessionStorage, saved);
    } catch {
      this.state = {
        ...state,
        registering: false,
        loginProblem: {
          summary: "The browser wouldn't let the app keep what the login needs",
          detail:
            "The app keeps the login's one-time secrets in session storage while you're away, and the browser refused. Allow storage for this site, then try again.",
        },
      };
      return;
    }
    this.state = { kind: "leaving", issuer: configuration.issuer };
    location.assign(prepared.authorizationUrl);
  }

  readonly #choose = (event: ChooseEvent): void => {
    const state = this.state;
    if (state.kind !== "done" || !state.result.ok) {
      return;
    }
    this.state = { ...state, choice: choose(state.choice, state.result, event.detail) };
  };
}

/** The configuration of the provider the person chose, if it can log them in. */
function chosenConfiguration(state: State & { kind: "done" }): IssuerConfiguration | null {
  if (!state.result.ok || state.choice.issuer === null) {
    return null;
  }
  const issuer = state.choice.issuer;
  const finding = state.result.providers.find((provider) => provider.issuer === issuer);
  return finding?.result.ok === true ? finding.result.configuration : null;
}

/** A client_id registered earlier in this tab, or null, including when storage is blocked. */
function recalledRegistration(issuer: string, redirectUri: string): string | null {
  try {
    return recallRegistration(sessionStorage, issuer, redirectUri);
  } catch {
    return null;
  }
}

/**
 * Forgets a registration the provider no longer recognises, so the next
 * login registers again rather than failing the same way.
 */
function forgetRejectedClient(pending: PendingLogin, error: string): void {
  if (error !== "invalid_client" && error !== "unauthorized_client") {
    return;
  }
  try {
    forgetRegistration(sessionStorage, pending.issuer, pending.redirectUri);
  } catch {
    // Storage is blocked, so nothing was kept.
  }
}

/**
 * Where the app is served from: the start page, which is the redirect
 * address the Client ID Document lists, and the one a registration sends.
 */
function siteUrl(): URL {
  return new URL("./", new URL(location.pathname, location.origin));
}

/**
 * The key pair kept from an earlier login, or a new one, kept for next time.
 * If IndexedDB is unavailable the new key is used for this login only.
 */
async function dpopKeyPair(): Promise<CryptoKeyPair> {
  try {
    const stored = await loadDpopKeyPair();
    if (stored !== null) {
      return stored;
    }
  } catch {
    // Storage is blocked: make a key for this login only.
  }
  const keyPair = await generateDpopKeyPair();
  try {
    await saveDpopKeyPair(keyPair);
  } catch {
    // As above: the key still works, but isn't kept.
  }
  return keyPair;
}

/** The login saved before the redirect, or null if there isn't one or storage is blocked. */
function takeSavedLogin(): SavedLogin | null {
  try {
    return takeLogin(sessionStorage);
  } catch {
    return null;
  }
}

customElements.define("demonstrator-app", DemonstratorApp);
