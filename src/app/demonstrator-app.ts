import { css, html, LitElement, nothing } from "lit";
import { type DiscoveryResult, discover } from "../core/discovery.ts";
import { describeWebIdProblem } from "../core/messages.ts";
import { createTrace } from "../core/trace.ts";
import { createTracedFetch } from "../core/traced-fetch.ts";
import "./discovery-results.ts";

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly typed: string }
  | { readonly kind: "done"; readonly result: DiscoveryResult };

/**
 * The demonstrator's root element: the start page's introduction, the
 * WebID form, and what discovery finds. Login and the Pod views arrive in
 * later milestones (see PLAN.md).
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
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `;

  /** One trace for the page's whole life; the timeline view will show it. */
  readonly #trace = createTrace({ now: () => new Date(), entriesMax: 500 });

  readonly #tracedFetch = createTracedFetch({
    fetch: (input, init) => globalThis.fetch(input, init),
    trace: this.#trace,
    timeoutMs: 15_000,
    recordedTextMax: 100_000,
  });

  constructor() {
    super();
    this.state = { kind: "idle" };
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
            ? html`<discovery-results .result=${state.result}></discovery-results>`
            : nothing
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
    this.state = { kind: "done", result };
  };
}

customElements.define("demonstrator-app", DemonstratorApp);
