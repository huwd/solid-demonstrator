/**
 * Where the map of the parties draws everything (decision 0019).
 *
 * Each kind of party has a place around the app. Lines run between the app
 * and each party, one for each direction and provenance seen, spread along
 * the card's edge. A repeated check the app makes on its own is a loop on
 * the app, and an explained step is a note on its party, never a line
 * (decision 0004). Parties not found yet are drawn as places to expect,
 * joined by faint lines.
 */

import { isMarked, type Journey, lanes, otherParty } from "./journey.ts";
import type { Party, Provenance, Verdict } from "./trace.ts";

export const mapSize = { width: 1000, height: 520 } as const;
const card = { width: 200, height: 72 } as const;

const places: Readonly<Record<Party, { readonly x: number; readonly y: number }>> = {
  "identity-provider": { x: 400, y: 40 },
  "webid-profile": { x: 40, y: 216 },
  app: { x: 400, y: 216 },
  pod: { x: 760, y: 216 },
  "notification-service": { x: 760, y: 392 },
};

const hints: Readonly<Record<Party, string>> = {
  app: "in your browser",
  "webid-profile": "the WebID you enter",
  "identity-provider": "named by the profile",
  pod: "named by the profile",
  "notification-service": "named by the Pod",
};

export type Point = readonly [x: number, y: number];

export interface Card {
  readonly party: Party;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** False for a party not found yet, drawn as a place to expect. */
  readonly found: boolean;
  readonly hosts: readonly string[];
  /** The hosts it was reached at, or a hint at where it'll come from. */
  readonly detail: string;
  readonly marked: boolean;
  readonly explained: number;
}

export type LineStyle = Exclude<Provenance, "explained"> | "expected";

export interface Line {
  readonly from: Party;
  readonly to: Party;
  readonly style: LineStyle;
  /** The most serious verdict among the exchanges it stands for. */
  readonly verdict: Verdict["kind"];
  /** The exchanges it stands for, by trace entry id, in order. */
  readonly ids: readonly number[];
  /** From tail to tip. */
  readonly points: readonly Point[];
  /** A status or "failed" for a marked line, else null. */
  readonly label: string | null;
}

export interface Band {
  readonly host: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MapLayout {
  readonly cards: readonly Card[];
  readonly lines: readonly Line[];
  /** Parties from the same host, where they can be boxed without enclosing another. */
  readonly bands: readonly Band[];
  /** The app's own repeated checks, drawn as a loop, or null if there are none. */
  readonly loop: Line | null;
}

const severity: readonly Verdict["kind"][] = ["as-expected", "pending", "unexpected", "failed"];
const worse = (a: Verdict["kind"], b: Verdict["kind"]) =>
  severity.indexOf(a) >= severity.indexOf(b) ? a : b;

interface Group {
  from: Party;
  to: Party;
  style: LineStyle;
  verdict: Verdict["kind"];
  ids: number[];
  status: number | null;
}

export function layOutMap(journey: Journey): MapLayout {
  const cards = cardsFor(journey);
  const { groups, loop } = groupExchanges(journey);

  // Every party the app hasn't exchanged anything with yet gets a faint line to expect.
  const reached = new Set([...groups.values()].map(otherParty));
  const expected = lanes
    .filter((party) => party !== "app" && !reached.has(party))
    .map(
      (party): Group => ({
        from: "app",
        to: party,
        style: "expected",
        verdict: "pending",
        ids: [],
        status: null,
      }),
    );

  const byParty = new Map<Party, Group[]>();
  for (const group of [...groups.values(), ...expected]) {
    const party = otherParty(group);
    byParty.set(party, [...(byParty.get(party) ?? []), group]);
  }
  const lines = [...byParty].flatMap(([party, shared]) =>
    shared.map((group, index) => toLine(group, edge(party, index, shared.length))),
  );

  return {
    cards,
    lines,
    bands: bandsFor(cards),
    loop: loop === null ? null : toLine(loop, loopPoints),
  };
}

function cardsFor(journey: Journey): readonly Card[] {
  return lanes.map((party): Card => {
    const found = journey.found.find((candidate) => candidate.party === party);
    return {
      party,
      ...places[party],
      ...card,
      found: found !== undefined,
      hosts: found?.hosts ?? [],
      detail:
        found === undefined || found.hosts.length === 0 ? hints[party] : found.hosts.join(", "),
      marked: found?.marked ?? false,
      explained: found?.explained ?? 0,
    };
  });
}

/** One group for each direction and provenance, and one for the app's own checks. */
function groupExchanges(journey: Journey): { groups: Map<string, Group>; loop: Group | null } {
  const groups = new Map<string, Group>();
  let loop: Group | null = null;
  for (const exchange of journey.exchanges) {
    if (exchange.provenance === "explained") {
      continue;
    }
    const own = exchange.from === exchange.to;
    const key = `${exchange.from}>${exchange.to}:${exchange.provenance}`;
    const group = own ? loop : groups.get(key);
    const next: Group = {
      from: exchange.from,
      to: exchange.to,
      style: exchange.provenance,
      verdict: worse(group?.verdict ?? "as-expected", exchange.verdict),
      ids: [...(group?.ids ?? []), exchange.id],
      status: isMarked(exchange.verdict) ? exchange.status : (group?.status ?? null),
    };
    if (own) {
      loop = next;
    } else {
      groups.set(key, next);
    }
  }
  return { groups, loop };
}

function toLine(group: Group, path: readonly Point[]): Line {
  const points = group.from === "app" ? path : [...path].reverse();
  return {
    from: group.from,
    to: group.to,
    style: group.style,
    verdict: group.verdict,
    ids: group.ids,
    points,
    label: isMarked(group.verdict)
      ? group.status === null
        ? "failed"
        : String(group.status)
      : null,
  };
}

const app = places.app;
const loopPoints: readonly Point[] = [
  [app.x + 180, app.y + card.height],
  [app.x + 180, app.y + card.height + 32],
  [app.x + 148, app.y + card.height + 32],
  [app.x + 148, app.y + card.height],
];

/** The path from the app to a party, for the index-th of count lines sharing the edge. */
function edge(party: Party, index: number, count: number): readonly Point[] {
  const along = (length: number) => Math.round((length * (index + 1)) / (count + 1));
  switch (party) {
    case "webid-profile": {
      const y = app.y + along(card.height);
      return [
        [app.x, y],
        [places[party].x + card.width, y],
      ];
    }
    case "identity-provider": {
      const x = app.x + along(card.width);
      return [
        [x, app.y],
        [x, places[party].y + card.height],
      ];
    }
    case "pod": {
      const y = app.y + along(card.height);
      return [
        [app.x + card.width, y],
        [places[party].x, y],
      ];
    }
    default: {
      // The notification service, below the Pod: down from the app, then across.
      // Each further line runs outside the one before, so none cross.
      const x = app.x + card.width / 2 - 20 * index;
      const y = places["notification-service"].y + along(card.height);
      return [
        [x, app.y + card.height],
        [x, y],
        [places["notification-service"].x, y],
      ];
    }
  }
}

const bandPadding = 16;

function bandsFor(cards: readonly Card[]): readonly Band[] {
  const byHost = new Map<string, Card[]>();
  for (const candidate of cards) {
    for (const host of candidate.hosts) {
      byHost.set(host, [...(byHost.get(host) ?? []), candidate]);
    }
  }
  return [...byHost].flatMap(([host, members]) => {
    if (members.length < 2) {
      return [];
    }
    const left = Math.min(...members.map((member) => member.x)) - bandPadding;
    const top = Math.min(...members.map((member) => member.y)) - bandPadding - 16;
    const right = Math.max(...members.map((member) => member.x + member.width)) + bandPadding;
    const bottom = Math.max(...members.map((member) => member.y + member.height)) + bandPadding;
    const encloses = cards.some(
      (other) =>
        !members.includes(other) &&
        other.x < right &&
        other.x + other.width > left &&
        other.y < bottom &&
        other.y + other.height > top,
    );
    return encloses ? [] : [{ host, x: left, y: top, width: right - left, height: bottom - top }];
  });
}
