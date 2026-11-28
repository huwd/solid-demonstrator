import { css, html, LitElement } from "lit";
import { aliceScript, chapterOfEntry, exampleEntries } from "../core/script.ts";
import type { TraceEntry } from "../core/trace.ts";
import "./trace-timeline.ts";

const entries = exampleEntries(aliceScript);

/** How long each step stays on screen while the introduction plays. */
const stepMilliseconds = 2200;

/**
 * The introduction (decision 0020): Alice's journey, played step by step
 * through the same map, timeline and detail as a live session. Every
 * exchange is an example, and is badged as one.
 */
export class SolidIntroduction extends LitElement {
  static override properties = {
    shown: { state: true },
    playing: { state: true },
  };

  /** How many of the example steps are on screen. */
  declare shown: number;
  declare playing: boolean;

  #timer: ReturnType<typeof setInterval> | null = null;
  #listeners = new Set<(entries: readonly TraceEntry[]) => void>();
  /** The example steps on screen, offered to the timeline as a trace would be. */
  readonly #source = {
    entries: () => entries.slice(0, this.shown),
    subscribe: (listener: (entries: readonly TraceEntry[]) => void) => {
      this.#listeners.add(listener);
      return () => this.#listeners.delete(listener);
    },
  };

  static override styles = css`
    :host {
      display: block;
    }
    .narration {
      max-width: 44rem;
    }
    .watch {
      color: GrayText;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      margin: 0 0 1rem;
    }
    button {
      font: inherit;
      padding: 0.4rem 1rem;
    }
  `;

  constructor() {
    super();
    this.shown = 0;
    this.playing = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#pause();
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("shown")) {
      for (const listener of this.#listeners) {
        listener(this.#source.entries());
      }
    }
  }

  override render() {
    const chapterIndex = this.shown === 0 ? 0 : chapterOfEntry(aliceScript, this.shown);
    const chapter = aliceScript[chapterIndex] ?? aliceScript[0];
    const last = this.shown === entries.length;
    return html`
      <div class="narration" aria-live="polite">
        <h3>${chapter?.title}</h3>
        <p>${chapter?.narration}</p>
        <p class="watch">${chapter?.watchFor}</p>
      </div>
      <div class="controls" role="group" aria-label="Play the introduction">
        <button type="button" ?disabled=${this.shown === 0} @click=${() => this.#back()}>
          Back
        </button>
        <button type="button" ?disabled=${last} @click=${() => this.#toggle()}>
          ${this.playing ? "Pause" : this.shown === 0 ? "Play" : "Carry on"}
        </button>
        <button type="button" ?disabled=${last} @click=${() => this.#next()}>Next chapter</button>
        <span>Chapter ${chapterIndex + 1} of ${aliceScript.length}</span>
      </div>
      ${
        this.shown === 0
          ? html``
          : html`<trace-timeline example .trace=${this.#source}></trace-timeline>`
      }
    `;
  }

  #toggle(): void {
    if (this.playing) {
      this.#pause();
      return;
    }
    this.playing = true;
    this.#step();
    this.#timer = setInterval(() => this.#step(), stepMilliseconds);
  }

  #step(): void {
    this.shown = Math.min(this.shown + 1, entries.length);
    if (this.shown === entries.length) {
      this.#pause();
    }
  }

  #pause(): void {
    this.playing = false;
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Shows the whole of the next chapter. */
  #next(): void {
    this.#pause();
    this.shown = endOfChapter(this.shown === 0 ? 1 : chapterOfEntry(aliceScript, this.shown) + 1);
  }

  /** Goes back to the end of the chapter before this one. */
  #back(): void {
    this.#pause();
    const current = chapterOfEntry(aliceScript, this.shown);
    const end = endOfChapter(current - 1);
    this.shown = end === this.shown ? endOfChapter(current - 2) : end;
  }
}

/** How many steps there are up to the end of a chapter. */
function endOfChapter(chapter: number): number {
  return aliceScript
    .slice(0, Math.max(chapter + 1, 0))
    .reduce((count, each) => count + each.steps.length, 0);
}

customElements.define("solid-introduction", SolidIntroduction);
