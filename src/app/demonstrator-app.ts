import { css, html, LitElement, nothing } from "lit";
import { type Choice, choose, initialChoice } from "../core/choice.ts";
import { clientIdDocumentPath } from "../core/client-id.ts";
import { type DiscoveryResult, discover } from "../core/discovery.ts";
import type { IssuerConfiguration } from "../core/issuer.ts";
import { prepareLogin } from "../core/login.ts";
import { isLoginReturn, type ReturnResult, returnFromLogin } from "../core/login-return.ts";
import { type SavedLogin, saveLogin, takeLogin } from "../core/login-storage.ts";
import { describeReturnProblem, describeWebIdProblem, type Message } from "../core/messages.ts";
import { createTrace, type Trace } from "../core/trace.ts";
import { createTracedFetch, type TracedFetch } from "../core/traced-fetch.ts";
import type { ChooseEvent } from "./discovery-results.ts";
import "./discovery-results.ts";
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
    }
  | { readonly kind: "leaving"; readonly issuer: string }
  | { readonly kind: "returned"; readonly issuer: string; readonly result: ReturnResult }
  /** A login response arrived, but this tab started no login. */
  | { readonly kind: "unexpected-return" };

/**
 * The demonstrator's root element: the start page's introduction, the
 * WebID form, what discovery finds, and login as far as the person coming
 * back from their identity provider. The code exchange and the Pod views
 * arrive in later pull requests (see PLAN.md).
 */
export class DemonstratorApp extends LitElement {
  static override properties = { state: { state: true } };

  declare state: State;

  static override styles = css`
    :host {
      display: block;
      max-width: 44rem;
      margin: 0 auto;
      padding: 2rem 1rem;
      font-family: system-ui, sans-serif;
      line-height: 1.5;
      color: CanvasText;
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
    this.state =
      saved === null
        ? { kind: "unexpected-return" }
        : {
            kind: "returned",
            issuer: saved.pending.issuer,
            result: returnFromLogin(saved.pending, here, this.#trace),
          };
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
          state.kind === "idle"
            ? nothing
            : html`
              <h2>Every exchange so far</h2>
              <p>
                Each request the app made, in order. Open one to see what was sent and what came
                back. Secrets are hidden or shortened before anything is recorded.
              </p>
              <trace-timeline .trace=${this.#trace}></trace-timeline>
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
    };
  };

  #renderLogin(state: State & { kind: "done" }) {
    const configuration = chosenConfiguration(state);
    if (configuration === null) {
      return nothing;
    }
    if (!configuration.clientIdDocuments) {
      return html`
        <h2>Log in</h2>
        <p>
          ${configuration.issuer} doesn't read Client ID Documents, so the app would have to register
          with it first. Logging in with registration arrives in a later version.
        </p>
      `;
    }
    return html`
      <h2>Log in</h2>
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
      <button type="button" @click=${() => this.#logIn(state, configuration)}>
        Log in with ${configuration.issuer}
      </button>
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
      case "returned": {
        if (!state.result.ok) {
          const message = describeReturnProblem(state.result.problem, state.issuer);
          return html`<div class="problem" role="alert">
            <p class="summary">${message.summary}</p>
            <p>${message.detail}</p>
          </div>`;
        }
        return html`<div class="ready">
          <p class="summary">Back from ${state.issuer}</p>
          <p>
            The response is the one the app asked for: its state matches, and it names the provider
            you chose. Next, the app would exchange the one-time code for tokens. That step arrives
            in a later version.
          </p>
        </div>`;
      }
      default:
        return nothing;
    }
  }

  async #logIn(state: State & { kind: "done" }, configuration: IssuerConfiguration): Promise<void> {
    // The start page is the redirect address the Client ID Document lists.
    const site = new URL("./", new URL(location.pathname, location.origin));
    const prepared = await prepareLogin(configuration, {
      clientId: new URL(clientIdDocumentPath, site).href,
      redirectUri: site.href,
    });
    const saved: SavedLogin = { pending: prepared.pending, entries: this.#trace.entries() };
    try {
      saveLogin(sessionStorage, saved);
    } catch {
      this.state = {
        ...state,
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

/** The login saved before the redirect, or null if there isn't one or storage is blocked. */
function takeSavedLogin(): SavedLogin | null {
  try {
    return takeLogin(sessionStorage);
  } catch {
    return null;
  }
}

customElements.define("demonstrator-app", DemonstratorApp);
