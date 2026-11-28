import { css, html, LitElement, nothing, svg, type TemplateResult } from "lit";
import { fieldNote, headerNote } from "../core/field-notes.ts";
import { type ChapterSummary, chaptersOf, journeyOf, lanes } from "../core/journey.ts";
import type {
  Header,
  Party,
  RecordedBody,
  RecordedRequest,
  RecordedResponse,
  Trace,
  TraceEntry,
  Verdict,
} from "../core/trace.ts";
import {
  partyName,
  provenanceLabel,
  showBody,
  showsExchange,
  verdictLabel,
} from "../core/trace-format.ts";
import "./journey-map.ts";

/**
 * The plumbing view (decision 0018): the map of the parties, the sequence
 * timeline in chapters, and the detail of the step the cursor is on.
 *
 * The cursor follows the newest step until the person picks another, or
 * steps back. Entries reach the trace already redacted (decision 0005), so
 * this only lays them out. Explained entries are never laid out as a log
 * (decision 0004).
 */
export class TraceTimeline extends LitElement {
  static override properties = {
    trace: { attribute: false },
    entries: { state: true },
    selected: { state: true },
  };

  declare trace: Trace | undefined;
  declare entries: readonly TraceEntry[];
  /** The step the person picked, or null to follow the newest. */
  declare selected: number | null;

  #unsubscribe: (() => void) | null = null;

  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
      --seen: light-dark(#1d70b8, #8ab4f8);
      --marked: light-dark(#b00020, #ff8a80);
      --lane: light-dark(#dcd8cf, #3b3b3b);
      --current: light-dark(#e8eefb, #1c2b44);
    }
    .map summary,
    .controls {
      margin: 0 0 0.75rem;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }
    .controls button {
      min-height: 2.75rem;
      padding: 0 1rem;
    }
    .controls label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 2.75rem;
    }
    .columns {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      gap: 1.5rem;
      align-items: start;
    }
    @container (max-width: 52rem) {
      .columns {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    section {
      margin: 0 0 1.25rem;
    }
    h3 {
      margin: 0;
    }
    .summary {
      margin: 0 0 0.5rem;
    }
    ol {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    li {
      border-left: 0.3rem solid transparent;
    }
    li.unexpected,
    li.failed {
      border-color: var(--marked);
    }
    li[aria-current] {
      background: var(--current);
      border-color: var(--seen);
    }
    li > button {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      padding: 0.25rem 0.5rem 0.25rem 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .lanes {
      flex: none;
    }
    @container (max-width: 30rem) {
      .lanes {
        display: none;
      }
    }
    .route {
      font-weight: bold;
    }
    .tag {
      display: inline-block;
      font-size: 0.85em;
      padding: 0 0.4rem;
      margin-left: 0.25rem;
      border: 1px solid;
      border-radius: 0.2rem;
    }
    .purpose {
      display: block;
    }
    aside {
      position: sticky;
      top: 1rem;
      padding: 1rem;
      border: 1px solid var(--lane);
      border-radius: 0.5rem;
      min-width: 0;
    }
    aside h3 {
      margin: 0.25rem 0;
    }
    h4 {
      margin: 0.75rem 0 0.25rem;
    }
    .field {
      margin: 0 0 0.4rem;
    }
    .field code {
      display: block;
      overflow-wrap: anywhere;
    }
    pre {
      margin: 0;
      padding: 0.5rem;
      overflow-x: auto;
      background: light-dark(#f3f2f1, #1d1d1d);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .note {
      margin: 0.25rem 0;
      color: GrayText;
    }
    .explained {
      font-style: italic;
    }
  `;

  constructor() {
    super();
    this.trace = undefined;
    this.entries = [];
    this.selected = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#follow();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("trace") && this.isConnected) {
      this.#follow();
    }
  }

  #follow(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.trace === undefined) {
      this.entries = [];
      return;
    }
    this.entries = this.trace.entries();
    this.#unsubscribe = this.trace.subscribe((entries) => {
      this.entries = entries;
    });
  }

  override render() {
    if (this.entries.length === 0) {
      return html`<p class="note">Nothing has been exchanged yet.</p>`;
    }
    const journey = journeyOf(this.entries);
    const current =
      this.entries.find((entry) => entry.id === this.selected) ??
      (this.entries.at(-1) as TraceEntry);
    const index = this.entries.indexOf(current);
    return html`
      <details class="map" open>
        <summary>The map of the parties</summary>
        <journey-map
          .journey=${journey}
          .selected=${current.id}
          @select=${(event: CustomEvent<number>) => this.#select(event.detail)}
        ></journey-map>
      </details>
      <div class="controls" role="group" aria-label="Step through the journey">
        <button type="button" ?disabled=${index === 0} @click=${() => this.#step(index - 1)}>
          Previous step
        </button>
        <span>Step ${index + 1} of ${this.entries.length}</span>
        <button
          type="button"
          ?disabled=${index === this.entries.length - 1}
          @click=${() => this.#step(index + 1)}
        >
          Next step
        </button>
        <label>
          <input
            type="checkbox"
            .checked=${this.selected === null}
            @change=${(event: Event) => {
              this.selected = (event.target as HTMLInputElement).checked ? null : current.id;
            }}
          />
          Follow new steps
        </label>
      </div>
      <div class="columns">
        <div>${chaptersOf(journey).map((chapter) => this.#chapter(chapter, current.id))}</div>
        <aside aria-label="The selected step">${renderDetail(current)}</aside>
      </div>
    `;
  }

  #chapter(chapter: ChapterSummary, current: number): TemplateResult {
    const entries = chapter.exchanges.map(
      (exchange) => this.entries.find((entry) => entry.id === exchange.id) as TraceEntry,
    );
    return html`<section aria-label=${chapter.title}>
      <h3>${chapter.title}</h3>
      <p class="summary">${chapter.summary}</p>
      <ol>
        ${entries.map((entry) => this.#item(entry, entry.id === current))}
      </ol>
    </section>`;
  }

  #item(entry: TraceEntry, current: boolean): TemplateResult {
    const provenance = provenanceLabel(entry.provenance);
    return html`
      <li
        class=${entry.verdict.kind}
        data-step=${entry.step}
        aria-current=${current ? "step" : nothing}
      >
        <button type="button" @click=${() => this.#select(entry.id)}>
          ${renderLanes(entry)}
          <span>
            <span class="route">${entry.id}. ${partyName(entry.from)} → ${partyName(entry.to)}</span>
            <span class="tag" title=${provenance.meaning}>${provenance.label}</span>
            <span class="tag">${verdictLabel(entry.verdict)}</span>
            <span class="purpose">${entry.purpose}</span>
          </span>
        </button>
      </li>
    `;
  }

  #select(id: number): void {
    this.selected = id;
  }

  #step(index: number): void {
    const entry = this.entries[index];
    if (entry !== undefined) {
      this.selected = entry.id;
    }
  }
}

const laneX = (party: Party) => 12 + 28 * lanes.indexOf(party);

/** The parties' lanes, with the entry drawn across them. Decorative: the route says it in words. */
function renderLanes(entry: TraceEntry): TemplateResult {
  const marked = entry.verdict.kind === "unexpected" || entry.verdict.kind === "failed";
  const colour = marked ? "var(--marked)" : "var(--seen)";
  const from = laneX(entry.from);
  const to = laneX(entry.to);
  const lifelines = lanes.map(
    (party) =>
      svg`<path d="M ${laneX(party)} 0 L ${laneX(party)} 40" style="stroke: var(--lane); stroke-width: 1.5"></path>`,
  );
  let mark: ReturnType<typeof svg>;
  if (entry.provenance === "explained") {
    mark = svg`<rect x=${to - 7} y="13" width="14" height="14" rx="2" style="fill: light-dark(#fff4d6, #3d3524); stroke: #d9b350"></rect>`;
  } else if (entry.from === entry.to) {
    mark = svg`<path d="M ${from} 12 L ${from + 18} 12 L ${from + 18} 28 L ${from + 6} 28" style="fill: none; stroke: ${colour}; stroke-width: 2"></path>
      <path d="M ${from + 6} 23 L ${from} 28 L ${from + 6} 33 Z" style="fill: ${colour}"></path>`;
  } else {
    const way = to > from ? 1 : -1;
    mark = svg`<path d="M ${from} 20 L ${to - 6 * way} 20" style="stroke: ${colour}; stroke-width: 2; stroke-dasharray: ${entry.provenance === "reconstructed" ? "5 4" : "none"}"></path>
      <path d="M ${to} 20 L ${to - 7 * way} 15 L ${to - 7 * way} 25 Z" style="fill: ${colour}"></path>`;
  }
  return html`<svg class="lanes" aria-hidden="true" width="136" height="40" viewBox="0 0 136 40">
    ${lifelines}${mark}
  </svg>`;
}

function renderDetail(entry: TraceEntry): TemplateResult {
  const provenance = provenanceLabel(entry.provenance);
  const explained = !showsExchange(entry);
  return html`
    <p class="note">
      Step ${entry.id} · ${partyName(entry.from)} → ${partyName(entry.to)} · ${provenance.label} ·
      ${verdictLabel(entry.verdict)}
    </p>
    <h3>${entry.purpose}</h3>
    <p class="note">${provenance.meaning}</p>
    ${renderVerdict(entry.verdict)}
    ${entry.explanation === undefined ? nothing : html`<p class=${explained ? "explained" : ""}>${entry.explanation}</p>`}
    ${explained || entry.request === undefined ? nothing : renderRequest(entry.request)}
    ${explained || entry.response === undefined ? nothing : renderResponse(entry.response)}
    ${explained || entry.message === undefined ? nothing : html`<h4>Message</h4>${renderBody(entry.message)}`}
    ${
      entry.specification === undefined
        ? nothing
        : html`<p><a href=${entry.specification} rel="noreferrer">The specification for this step</a></p>`
    }
  `;
}

function renderVerdict(verdict: Verdict): TemplateResult | typeof nothing {
  switch (verdict.kind) {
    case "unexpected":
      return html`
        <h4>Not as expected</h4>
        <p>Expected ${verdict.expected}. Got ${verdict.actual}.</p>
      `;
    case "failed":
      return html`
        <h4>Diagnosis</h4>
        <p>${verdict.diagnosis.summary}</p>
      `;
    default:
      return nothing;
  }
}

function renderRequest(request: RecordedRequest): TemplateResult {
  const query = [...(URL.parse(request.url)?.searchParams ?? [])];
  return html`
    <h4>Request</h4>
    ${field(`${request.method} ${request.url}`, null)}
    ${query.map(([name, value]) => field(`${name}=${value}`, fieldNote(name)))}
    ${renderHeaders(request.headers)}
    ${renderBody(request.body)}
  `;
}

function renderResponse(response: RecordedResponse): TemplateResult {
  return html`
    <h4>Response</h4>
    ${field(`${response.status} ${response.statusText}`, null)}
    ${renderHeaders(response.headers)}
    ${renderBody(response.body)}
  `;
}

function renderHeaders(headers: readonly Header[]): TemplateResult[] {
  return headers.map(([name, value]) => field(`${name}: ${value}`, headerNote(name)));
}

function field(text: string, note: string | null): TemplateResult {
  return html`<div class="field">
    <code>${text}</code>${note === null ? nothing : html`<span class="note">${note}</span>`}
  </div>`;
}

function renderBody(body: RecordedBody): TemplateResult {
  if (body.kind === "form") {
    return html`<p class="note">Form fields:</p>
      ${body.fields.map(([name, value]) => field(`${name}=${value}`, fieldNote(name)))}`;
  }
  const shown = showBody(body);
  return html`
    ${shown.note === null ? nothing : html`<p class="note">${shown.note}</p>`}
    ${shown.text === null ? nothing : html`<pre>${shown.text}</pre>`}
  `;
}

customElements.define("trace-timeline", TraceTimeline);
