/**
 * A journey: the trace, shaped for the pictures of decision 0018. It says
 * which parties have been found, what passed between them, and which
 * chapter of the journey each exchange belongs to.
 *
 * Everything here is worked out from the trace alone, so the map, the
 * timeline and the detail can't disagree.
 */

import type { Party, Provenance, TraceEntry, Verdict } from "./trace.ts";

/** Every party, in the order the timeline's lanes show them. */
export const lanes: readonly Party[] = [
  "app",
  "webid-profile",
  "identity-provider",
  "pod",
  "notification-service",
];

/** A party's name, short enough to head its lane in the timeline. */
export function laneName(party: Party): string {
  return {
    app: "App",
    "webid-profile": "Profile",
    "identity-provider": "Provider",
    pod: "Pod",
    "notification-service": "Notices",
  }[party];
}

export type Chapter = "discovery" | "login" | "pod" | "notifications";

const chapterOfStep: Readonly<Record<string, Chapter>> = {
  fetchWebIdProfile: "discovery",
  discoverIssuer: "discovery",
  registerClient: "login",
  redirectToIdentityProvider: "login",
  loginAtIdentityProvider: "login",
  returnFromIdentityProvider: "login",
  exchangeCode: "login",
  checkTokenWebId: "login",
  // The app repeats the Pod's checks as it starts reading the Pod.
  checkPodTrust: "pod",
  readStorageDescription: "pod",
  readContainer: "pod",
  readResource: "pod",
  readAccessRules: "pod",
  createResource: "pod",
  updateResource: "pod",
  deleteResource: "pod",
  subscribe: "notifications",
  listen: "notifications",
  notification: "notifications",
};

const chapterTitles: Readonly<Record<Chapter, string>> = {
  discovery: "Finding the servers",
  login: "Logging in",
  pod: "Reading and writing",
  notifications: "Watching for changes",
};

/** One exchange, or one step known some other way, as the pictures draw it. */
export interface Exchange {
  readonly id: number;
  readonly step: string;
  readonly chapter: Chapter;
  readonly from: Party;
  readonly to: Party;
  readonly purpose: string;
  readonly provenance: Provenance;
  readonly verdict: Verdict["kind"];
  readonly at: string;
  /** The response's status, where there was one. */
  readonly status: number | null;
  /** The host the request went to, where there was one. */
  readonly host: string | null;
}

export interface FoundParty {
  readonly party: Party;
  /** The hosts it was reached at, in the order they were first seen. */
  readonly hosts: readonly string[];
  /** Whether an exchange with it went other than expected, or failed. */
  readonly marked: boolean;
  /** How many steps it took that the app can only explain. */
  readonly explained: number;
}

export interface Journey {
  readonly exchanges: readonly Exchange[];
  /** The parties found so far, in the order they were found. The app is always first. */
  readonly found: readonly FoundParty[];
}

export function journeyOf(entries: readonly TraceEntry[]): Journey {
  let chapter: Chapter = "discovery";
  const exchanges = entries.map((entry): Exchange => {
    chapter = chapterOfStep[entry.step] ?? chapter;
    return {
      id: entry.id,
      step: entry.step,
      chapter,
      from: entry.from,
      to: entry.to,
      purpose: entry.purpose,
      provenance: entry.provenance,
      verdict: entry.verdict.kind,
      at: entry.at,
      status: entry.response?.status ?? null,
      // Only a request the app sent says where the other party is; a return to the app carries the app's own address.
      host:
        entry.request === undefined || entry.from !== "app"
          ? null
          : (URL.parse(entry.request.url)?.host ?? null),
    };
  });
  return { exchanges, found: foundParties(exchanges) };
}

/** The party an exchange is with, other than the app; the app if it's the app's own. */
export function otherParty(exchange: Pick<Exchange, "from" | "to">): Party {
  return exchange.from === "app" ? exchange.to : exchange.from;
}

export function isMarked(verdict: Verdict["kind"]): boolean {
  return verdict === "unexpected" || verdict === "failed";
}

function foundParties(exchanges: readonly Exchange[]): readonly FoundParty[] {
  const found = new Map<Party, { hosts: string[]; marked: boolean; explained: number }>([
    ["app", { hosts: [], marked: false, explained: 0 }],
  ]);
  const get = (party: Party) => {
    let record = found.get(party);
    if (record === undefined) {
      record = { hosts: [], marked: false, explained: 0 };
      found.set(party, record);
    }
    return record;
  };
  for (const exchange of exchanges) {
    get(exchange.from);
    const other = get(otherParty(exchange));
    if (exchange.provenance === "explained") {
      get(exchange.to).explained += 1;
      continue;
    }
    if (
      exchange.host !== null &&
      otherParty(exchange) !== "app" &&
      !other.hosts.includes(exchange.host)
    ) {
      other.hosts.push(exchange.host);
    }
    other.marked ||= isMarked(exchange.verdict);
  }
  return [...found].map(([party, record]) => ({ party, ...record }));
}

const nouns: Readonly<Record<Exclude<Party, "app">, readonly [one: string, many: string]>> = {
  "webid-profile": ["WebID profile", "WebID profiles"],
  "identity-provider": ["identity provider", "identity providers"],
  pod: ["Pod", "Pods"],
  "notification-service": ["notification service", "notification services"],
};

/**
 * The map's text equivalent: which parties have been found, in words, for
 * the person whose journey it is: "your" or, say, "Alice's".
 */
export function describeFound(journey: Journey, whose = "your"): string {
  const parts = lanes.flatMap((party) => {
    const found = journey.found.find((candidate) => candidate.party === party);
    if (party === "app" || found === undefined) {
      return [];
    }
    const count = Math.max(1, found.hosts.length);
    const [one, many] = nouns[party];
    return [
      party === "webid-profile" && count === 1
        ? `${whose} ${one}`
        : `${count} ${count === 1 ? one : many}`,
    ];
  });
  if (parts.length === 0) {
    return "Nothing found yet.";
  }
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Found so far: ${list}.`;
}

export interface ChapterSummary {
  readonly chapter: Chapter;
  readonly title: string;
  readonly exchanges: readonly Exchange[];
  /** What happened in the chapter, in a sentence. */
  readonly summary: string;
}

/** The journey's exchanges, grouped into chapters in the order they happened. */
export function chaptersOf(journey: Journey): readonly ChapterSummary[] {
  const groups: { chapter: Chapter; exchanges: Exchange[] }[] = [];
  for (const exchange of journey.exchanges) {
    const last = groups.at(-1);
    if (last?.chapter === exchange.chapter) {
      last.exchanges.push(exchange);
    } else {
      groups.push({ chapter: exchange.chapter, exchanges: [exchange] });
    }
  }
  return groups.map(({ chapter, exchanges }) => ({
    chapter,
    title: chapterTitles[chapter],
    exchanges,
    summary: summarise(exchanges),
  }));
}

function summarise(exchanges: readonly Exchange[]): string {
  const steps = exchanges.length === 1 ? "1 step" : `${exchanges.length} steps`;
  const marked = exchanges.filter((exchange) => isMarked(exchange.verdict)).length;
  const pending = exchanges.filter((exchange) => exchange.verdict === "pending").length;
  if (marked > 0) {
    return `${steps}. ${marked === 1 ? "1 went" : `${marked} went`} other than expected.`;
  }
  if (pending > 0) {
    return `${steps}. ${pending === 1 ? "1 is" : `${pending} are`} still waiting for an answer.`;
  }
  return `${steps}, all as expected.`;
}
