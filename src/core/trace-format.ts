/**
 * The words the timeline uses for a trace entry's parties, provenance,
 * verdict and bodies. Kept apart from the interface so they're tested in
 * Node, and so a shared trace reads the same wherever it's shown.
 */

import type { Party, Provenance, RecordedBody, TraceEntry, Verdict } from "./trace.ts";

export function partyName(party: Party): string {
  switch (party) {
    case "app":
      return "This app";
    case "webid-profile":
      return "WebID profile";
    case "identity-provider":
      return "Identity provider";
    case "pod":
      return "Pod";
    case "notification-service":
      return "Notification service";
    // Unreachable while the switch covers every party.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = party;
      throw new Error(`No name for ${String(unhandled)}`);
    }
  }
}

export interface ProvenanceLabel {
  readonly label: string;
  /** What the label means, for a tooltip or a key. */
  readonly meaning: string;
}

/** See docs/decisions/0004-label-how-each-step-is-known.md. */
export function provenanceLabel(provenance: Provenance): ProvenanceLabel {
  switch (provenance) {
    case "seen":
      return {
        label: "Seen",
        meaning: "The browser made this request and received this response.",
      };
    case "reconstructed":
      return {
        label: "Reconstructed",
        meaning:
          "Pieced together from what the browser could see before and after, because the exchange happened out of its sight.",
      };
    case "repeated":
      return {
        label: "Repeated",
        meaning: "A check another server makes, repeated in the browser with the same public data.",
      };
    case "explained":
      return {
        label: "Explained, not observed",
        meaning:
          "What the specification says happens here. Nothing was recorded, so this isn't a log.",
      };
    // Unreachable while the switch covers every provenance.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = provenance;
      throw new Error(`No label for ${String(unhandled)}`);
    }
  }
}

/**
 * Whether to lay out an entry's request and response. An explained entry
 * is never laid out as a log, even if a step gave it an example exchange
 * (decision 0004).
 */
export function showsExchange(entry: Pick<TraceEntry, "provenance">): boolean {
  return entry.provenance !== "explained";
}

export function verdictLabel(verdict: Verdict): string {
  switch (verdict.kind) {
    case "pending":
      return "In progress";
    case "as-expected":
      return "As expected";
    case "unexpected":
      return "Not as expected";
    case "failed":
      return "Failed";
    // Unreachable while the switch covers every verdict.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = verdict;
      throw new Error(`No label for ${JSON.stringify(unhandled)}`);
    }
  }
}

export interface ShownBody {
  /** The body as text to show in a fixed-width block, or null for none. */
  readonly text: string | null;
  /** A note to show with it, such as why it's missing or cut short. */
  readonly note: string | null;
}

/** How a recorded body is shown. It has already been redacted. */
export function showBody(body: RecordedBody): ShownBody {
  switch (body.kind) {
    case "none":
      return { text: null, note: "No body." };
    case "unrecorded":
      return { text: null, note: "The body wasn't recorded." };
    case "text":
      return {
        text: body.text,
        note: body.truncated ? "Cut short: only the start of the body was kept." : null,
      };
    case "json":
      return { text: JSON.stringify(body.value, null, 2), note: null };
    case "form":
      return {
        text: body.fields.map(([name, value]) => `${name}=${value}`).join("\n"),
        note: "Form fields, one a line.",
      };
    // Unreachable while the switch covers every body.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = body;
      throw new Error(`No way to show ${JSON.stringify(unhandled)}`);
    }
  }
}
