import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import type {
  Header,
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

/**
 * Every exchange so far, in order, each opening to show its detail. Entries
 * reach the trace already redacted (decision 0005), so this only lays them
 * out. Explained entries are never laid out as a log (decision 0004).
 */
export class TraceTimeline extends LitElement {
  static override properties = {
    trace: { attribute: false },
    entries: { state: true },
  };

  declare trace: Trace | undefined;
  declare entries: readonly TraceEntry[];

  #unsubscribe: (() => void) | null = null;

  static override styles = css`
    :host {
      display: block;
    }
    ol {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    li {
      border-left: 0.3rem solid light-dark(#b1b4b6, #6f777b);
      margin: 0 0 0.5rem;
      padding: 0.25rem 0 0.25rem 0.75rem;
    }
    li.unexpected,
    li.failed {
      border-color: light-dark(#b00020, #ff8a80);
    }
    summary {
      cursor: pointer;
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
    h4 {
      margin: 0.75rem 0 0.25rem;
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
    return html`<ol>${this.entries.map(renderEntry)}</ol>`;
  }
}

function renderEntry(entry: TraceEntry): TemplateResult {
  const provenance = provenanceLabel(entry.provenance);
  const explained = !showsExchange(entry);
  return html`
    <li class=${entry.verdict.kind} data-step=${entry.step}>
      <details>
        <summary>
          <span class="route">${entry.id}. ${partyName(entry.from)} → ${partyName(entry.to)}</span>
          <span class="tag" title=${provenance.meaning}>${provenance.label}</span>
          <span class="tag">${verdictLabel(entry.verdict)}</span>
          <span class="purpose">${entry.purpose}</span>
        </summary>
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
      </details>
    </li>
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
  return html`
    <h4>Request</h4>
    <pre>${request.method} ${request.url}${renderHeaders(request.headers)}</pre>
    ${renderBody(request.body)}
  `;
}

function renderResponse(response: RecordedResponse): TemplateResult {
  return html`
    <h4>Response</h4>
    <pre>${response.status} ${response.statusText}${renderHeaders(response.headers)}</pre>
    ${renderBody(response.body)}
  `;
}

function renderHeaders(headers: readonly Header[]): string {
  return headers.map(([name, value]) => `\n${name}: ${value}`).join("");
}

function renderBody(body: RecordedRequest["body"]): TemplateResult {
  const shown = showBody(body);
  return html`
    ${shown.note === null ? nothing : html`<p class="note">${shown.note}</p>`}
    ${shown.text === null ? nothing : html`<pre>${shown.text}</pre>`}
  `;
}

customElements.define("trace-timeline", TraceTimeline);
