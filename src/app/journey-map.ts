import { css, html, LitElement, nothing, type SVGTemplateResult, svg } from "lit";
import { describeFound, type Journey } from "../core/journey.ts";
import { type Card, type Line, layOutMap, mapSize, type Point } from "../core/journey-layout.ts";
import { partyName } from "../core/trace-format.ts";

/**
 * The map of the parties (decision 0018), drawn as SVG (decision 0019).
 *
 * The timeline is the text equivalent: this picture says in words which
 * parties have been found, and clicking a line selects its latest step,
 * which the timeline also offers. The newest exchange pulses along its line,
 * unless the browser asks for reduced motion.
 */
export class JourneyMap extends LitElement {
  static override properties = {
    journey: { attribute: false },
    selected: { attribute: false },
    ghosts: { attribute: false },
  };

  declare journey: Journey;
  /** The trace entry the cursor is on, or null. */
  declare selected: number | null;
  /** Whether to draw parties not found yet as places to expect, or leave them out. */
  declare ghosts: boolean;

  #pulsed = 0;
  #shownParties = new Set<string>();

  static override styles = css`
    :host {
      display: block;
      --seen: light-dark(#1d70b8, #8ab4f8);
      --expected: light-dark(#a8a398, #6f777b);
      --marked: light-dark(#b00020, #ff8a80);
      --card: light-dark(#ffffff, #1d1d1d);
      --ink: light-dark(#0b0c0c, #f3f2f1);
      --muted: light-dark(#505a5f, #b1b4b6);
      --note: light-dark(#fff4d6, #3d3524);
      --band: light-dark(#f3f2f1, #2b2b2b);
    }
    /* On a narrow screen the map keeps a readable size and scrolls within its box. */
    .scroll {
      overflow-x: auto;
    }
    svg {
      display: block;
      width: 100%;
      min-width: 40rem;
      height: auto;
      max-width: 62.5rem;
      font-family: inherit;
    }
    .line {
      fill: none;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .line.seen,
    .line.repeated {
      stroke: var(--seen);
    }
    .line.reconstructed {
      stroke: var(--seen);
      stroke-dasharray: 7 6;
    }
    .line.expected {
      stroke: var(--expected);
      stroke-dasharray: 3 6;
      stroke-width: 2;
    }
    .line.marked {
      stroke: var(--marked);
      stroke-width: 3.5;
    }
    .line.current {
      stroke-width: 5;
    }
    .hit {
      fill: none;
      stroke: transparent;
      stroke-width: 18;
      cursor: pointer;
    }
    .head.seen,
    .head.repeated,
    .head.reconstructed {
      fill: var(--seen);
    }
    .head.expected {
      fill: var(--expected);
    }
    .head.marked {
      fill: var(--marked);
    }
    .card rect {
      fill: var(--card);
      stroke: var(--ink);
      stroke-width: 1.5;
    }
    .card.app rect {
      stroke-width: 2.5;
    }
    .card.expected rect {
      stroke: var(--expected);
      stroke-dasharray: 5 4;
    }
    .card.marked rect {
      stroke: var(--marked);
      stroke-width: 3.5;
    }
    .card text {
      fill: var(--ink);
      text-anchor: middle;
    }
    .card.expected text,
    .detail {
      fill: var(--muted);
    }
    .name {
      font-weight: bold;
      font-size: 16px;
    }
    .detail,
    .label {
      font-size: 13px;
    }
    .label {
      fill: var(--marked);
      font-weight: bold;
    }
    .note rect {
      fill: var(--note);
    }
    .note text {
      fill: var(--ink);
      font-size: 12px;
      text-anchor: middle;
    }
    .band rect {
      fill: var(--band);
    }
    .band text {
      fill: var(--muted);
      font-size: 12px;
    }
    .pulse {
      fill: var(--seen);
    }
    p {
      margin: 0 0 0.5rem;
    }
  `;

  constructor() {
    super();
    this.journey = { exchanges: [], found: [] };
    this.selected = null;
    this.ghosts = true;
  }

  override render() {
    const laidOut = layOutMap(this.journey);
    const map = this.ghosts
      ? laidOut
      : {
          ...laidOut,
          cards: laidOut.cards.filter((card) => card.found),
          lines: laidOut.lines.filter((line) => line.style !== "expected"),
        };
    const found = describeFound(this.journey);
    return html`
      <p>${found}</p>
      <div class="scroll"><svg viewBox="0 0 ${mapSize.width} ${mapSize.height}" role="img" aria-label=${`The parties, and what passed between them. ${found}`}>
        ${map.bands.map(
          (band) => svg`<g class="band">
            <rect x=${band.x} y=${band.y} width=${band.width} height=${band.height} rx="14"></rect>
            <text x=${band.x + 10} y=${band.y + 16}>${band.host}</text>
          </g>`,
        )}
        ${[...map.lines, ...(map.loop === null ? [] : [map.loop])].map((line) => this.#line(line))}
        ${map.cards.map((card) => this.#card(card))}
        <circle class="pulse" r="6" cx="-20" cy="-20"></circle>
      </svg></div>
    `;
  }

  override updated(): void {
    this.#arrive();
    const latest = this.journey.exchanges.at(-1);
    if (latest === undefined || latest.id === this.#pulsed) {
      return;
    }
    this.#pulsed = latest.id;
    const line = [...layOutMap(this.journey).lines, layOutMap(this.journey).loop].find(
      (candidate) => candidate?.ids.at(-1) === latest.id,
    );
    const pulse = this.renderRoot.querySelector<SVGCircleElement>(".pulse");
    if (line == null || pulse === null || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    pulse.animate(
      line.points.map(([x, y]) => ({ transform: `translate(${x + 20}px, ${y + 20}px)` })),
      { duration: 700, easing: "ease-in-out" },
    );
  }

  /** Brings each newly found party onto the map, unless the browser asks for reduced motion. */
  #arrive(): void {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const card of this.renderRoot.querySelectorAll<SVGGElement>(".card.found")) {
      const party = card.dataset["party"] ?? "";
      if (this.#shownParties.has(party)) {
        continue;
      }
      this.#shownParties.add(party);
      if (!still) {
        card.animate(
          [
            { opacity: 0, transform: "translateY(-12px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 500, easing: "ease-out" },
        );
      }
    }
  }

  #line(line: Line): SVGTemplateResult {
    const marked = line.verdict === "unexpected" || line.verdict === "failed";
    const current = this.selected !== null && line.ids.includes(this.selected);
    const classes = `line ${line.style}${marked ? " marked" : ""}${current ? " current" : ""}`;
    const path = pathOf(line.points);
    const tip = line.points.at(-1) as Point;
    const before = line.points.at(-2) as Point;
    const latest = line.ids.at(-1);
    return svg`<g data-line=${`${line.from}>${line.to}:${line.style}`}>
      <path class=${classes} d=${path}></path>
      <path class="head ${line.style}${marked ? " marked" : ""}" d=${headPath(before, tip)}></path>
      ${
        latest === undefined
          ? nothing
          : svg`<path class="hit" d=${path} @click=${() => this.#select(latest)}></path>`
      }
      ${line.label === null ? nothing : svg`<text class="label" x=${labelPoint(line.points)[0]} y=${labelPoint(line.points)[1]}>${line.label}</text>`}
    </g>`;
  }

  #card(card: Card): SVGTemplateResult {
    const centre = card.x + card.width / 2;
    const state = card.found ? (card.marked ? "marked" : "found") : "expected";
    return svg`<g class="card ${card.party} ${state}" data-party=${card.party}>
      <rect x=${card.x} y=${card.y} width=${card.width} height=${card.height} rx="10"></rect>
      <text class="name" x=${centre} y=${card.y + 30}>${partyName(card.party)}</text>
      <text class="detail" x=${centre} y=${card.y + 52}>${shorten(card.detail)}</text>
      ${
        card.explained === 0
          ? nothing
          : svg`<g class="note">
              <rect x=${notePlace(card)[0]} y=${notePlace(card)[1]} width="140" height="22" rx="4"></rect>
              <text x=${notePlace(card)[0] + 70} y=${notePlace(card)[1] + 15}>${
                card.explained === 1 ? "1 step explained" : `${card.explained} steps explained`
              }</text>
            </g>`
      }
    </g>`;
  }

  #select(id: number): void {
    this.dispatchEvent(new CustomEvent("select", { detail: id, bubbles: true, composed: true }));
  }
}

/** Where a party's note on its explained steps goes, clear of its lines. */
function notePlace(card: Card): Point {
  switch (card.party) {
    case "app":
      return [card.x - 160, card.y - 34];
    case "identity-provider":
      return [card.x + card.width + 12, card.y + 25];
    default:
      return [card.x + 30, card.y + card.height + 6];
  }
}

function pathOf(points: readonly Point[]): string {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

/** An arrowhead at the tip, pointing the way the last segment runs. */
function headPath([fromX, fromY]: Point, [x, y]: Point): string {
  const angle = Math.atan2(y - fromY, x - fromX);
  const corner = (turn: number) =>
    `${x - 12 * Math.cos(angle + turn)} ${y - 12 * Math.sin(angle + turn)}`;
  return `M ${x} ${y} L ${corner(0.45)} L ${corner(-0.45)} Z`;
}

/** Beside the middle of the line's longest segment. */
function labelPoint(points: readonly Point[]): Point {
  const [x1, y1] = points.at(-2) as Point;
  const [x2, y2] = points.at(-1) as Point;
  return [(x1 + x2) / 2 - 12, (y1 + y2) / 2 + (y1 === y2 ? 20 : 4)];
}

function shorten(text: string): string {
  return text.length > 26 ? `${text.slice(0, 25)}…` : text;
}

customElements.define("journey-map", JourneyMap);
