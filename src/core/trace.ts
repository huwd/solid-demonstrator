/**
 * The trace: what the demonstrator did, in order, and how it knows.
 *
 * Every step records its exchanges here, and both views read from it, so
 * the outcome view and the plumbing view can't disagree. Entries are
 * redacted before they arrive (see redaction.ts).
 */

/** The parties a Solid interaction involves. See OUTCOMES.md, "The parties". */
export type Party = "app" | "webid-profile" | "identity-provider" | "pod" | "notification-service";

/**
 * How the demonstrator knows about an entry. See
 * docs/decisions/0004-label-how-each-step-is-known.md.
 */
export type Provenance = "seen" | "reconstructed" | "repeated" | "explained";

export type Header = readonly [name: string, value: string];

export type RecordedBody =
  | { readonly kind: "none" }
  | { readonly kind: "text"; readonly text: string; readonly truncated: boolean }
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "form"; readonly fields: readonly Header[] }
  | { readonly kind: "unrecorded" };

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly Header[];
  readonly body: RecordedBody;
}

export interface RecordedResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly Header[];
  readonly body: RecordedBody;
}

/** A token's header and claims, shown in place of the token itself. */
export interface DecodedToken {
  readonly label: string;
  readonly header: Readonly<Record<string, unknown>>;
  readonly claims: Readonly<Record<string, unknown>>;
}

/**
 * The demonstrator's best account of a failure the browser hides the cause
 * of. Always shown as a diagnosis, never as a fact.
 */
export interface Diagnosis {
  readonly kind: "timed-out" | "unreachable" | "blocked-likely-cors";
  readonly summary: string;
}

export type Verdict =
  | { readonly kind: "pending" }
  | { readonly kind: "as-expected" }
  | { readonly kind: "unexpected"; readonly expected: string; readonly actual: string }
  | { readonly kind: "failed"; readonly diagnosis: Diagnosis };

export interface EntryInput {
  /** The step that made the entry, such as `fetchWebIdProfile`. */
  readonly step: string;
  readonly from: Party;
  readonly to: Party;
  /** Why, in one sentence. */
  readonly purpose: string;
  readonly provenance: Provenance;
  readonly request?: RecordedRequest;
  readonly response?: RecordedResponse;
  readonly decodedTokens?: readonly DecodedToken[];
  /** What a reader should take from the entry. */
  readonly explanation?: string;
  /** The specification section the entry relies on. */
  readonly specification?: string;
  readonly verdict?: Verdict;
}

export interface TraceEntry extends EntryInput {
  readonly id: number;
  /** When the entry was added, as an ISO 8601 timestamp. */
  readonly at: string;
  readonly decodedTokens: readonly DecodedToken[];
  readonly verdict: Verdict;
}

export interface Trace {
  add(input: EntryInput): TraceEntry;
  /** Records the outcome of an entry once its step has checked it. */
  settle(id: number, verdict: Verdict): TraceEntry;
  entries(): readonly TraceEntry[];
  /** Calls the listener after every change. Returns a function that stops it. */
  subscribe(listener: (entries: readonly TraceEntry[]) => void): () => void;
}

export interface TraceOptions {
  readonly now: () => Date;
  /** A journey that exceeds this has gone wrong, so adding more throws. */
  readonly entriesMax: number;
}

export function createTrace(options: TraceOptions): Trace {
  let entries: readonly TraceEntry[] = [];
  const listeners = new Set<(entries: readonly TraceEntry[]) => void>();

  function publish(next: readonly TraceEntry[]): void {
    entries = next;
    for (const listener of listeners) {
      listener(entries);
    }
  }

  return {
    add(input) {
      if (entries.length >= options.entriesMax) {
        throw new Error(`The trace already holds its maximum of ${options.entriesMax} entries.`);
      }
      const entry: TraceEntry = {
        decodedTokens: [],
        verdict: { kind: "pending" },
        ...input,
        id: entries.length + 1,
        at: options.now().toISOString(),
      };
      publish([...entries, entry]);
      return entry;
    },

    settle(id, verdict) {
      const existing = entries.find((entry) => entry.id === id);
      if (existing === undefined) {
        throw new Error(`The trace has no entry ${id}.`);
      }
      const settled: TraceEntry = { ...existing, verdict };
      publish(entries.map((entry) => (entry.id === id ? settled : entry)));
      return settled;
    },

    entries() {
      return entries;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
