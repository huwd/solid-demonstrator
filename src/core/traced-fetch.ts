/**
 * The demonstrator's only way to make a request.
 *
 * Steps are given a traced fetch rather than calling `fetch` themselves, so
 * every exchange is recorded, with its purpose, after redaction. When a
 * request fails in a way the browser won't explain, the traced fetch makes
 * its best diagnosis and labels it as one (see
 * docs/decisions/0004-label-how-each-step-is-known.md).
 */

import { redactRequest, redactResponse } from "./redaction.ts";
import type { Diagnosis, EntryInput, RecordedBody, Trace, TraceEntry } from "./trace.ts";

/** What the step tells the trace about a request. */
export type RequestDescription = Pick<
  EntryInput,
  "step" | "from" | "to" | "purpose" | "explanation" | "specification"
>;

export interface TracedRequest {
  readonly describe: RequestDescription;
  readonly url: URL;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | URLSearchParams;
}

export type TracedResponse =
  | {
      readonly ok: true;
      readonly entry: TraceEntry;
      readonly status: number;
      readonly headers: Headers;
      /** The whole body, unredacted, for the step to use. */
      readonly text: string;
    }
  | { readonly ok: false; readonly entry: TraceEntry; readonly diagnosis: Diagnosis };

export type TracedFetch = (request: TracedRequest) => Promise<TracedResponse>;

export interface TracedFetchOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly trace: Trace;
  readonly timeoutMs: number;
  /** Longer text bodies are cut short in the trace, though steps get them whole. */
  readonly recordedTextMax: number;
}

export function createTracedFetch(options: TracedFetchOptions): TracedFetch {
  return async (request) => {
    const method = request.method ?? "GET";
    const headers = new Headers(request.headers);
    const sent = redactRequest({
      method,
      url: request.url.href,
      headers: [...headers],
      body: recordRequestBody(request.body, options.recordedTextMax),
    });

    let outcome: { response: Response; text: string } | { error: unknown };
    try {
      const response = await options.fetch(request.url, {
        method,
        headers,
        signal: AbortSignal.timeout(options.timeoutMs),
        ...(request.body === undefined ? {} : { body: request.body }),
      });
      outcome = { response, text: await response.text() };
    } catch (error) {
      outcome = { error };
    }

    if ("error" in outcome) {
      const failure = await diagnose(outcome.error, request.url, options);
      const entry = options.trace.add({
        ...request.describe,
        provenance: "seen",
        request: sent.value,
        decodedTokens: sent.decodedTokens,
        verdict: { kind: "failed", diagnosis: failure.diagnosis },
      });
      if (failure.probed) {
        recordProbe(request, failure.diagnosis, options.trace);
      }
      return { ok: false, entry, diagnosis: failure.diagnosis };
    }

    const { response, text } = outcome;
    const received = redactResponse({
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
      body: recordResponseBody(response.headers.get("content-type"), text, options.recordedTextMax),
    });
    const entry = options.trace.add({
      ...request.describe,
      provenance: "seen",
      request: sent.value,
      response: received.value,
      decodedTokens: [...sent.decodedTokens, ...received.decodedTokens],
    });
    return { ok: true, entry, status: response.status, headers: response.headers, text };
  };
}

const diagnoses = {
  timedOut: (timeoutMs: number): Diagnosis => ({
    kind: "timed-out",
    summary: `No complete response arrived within ${timeoutMs / 1000} seconds. The server may be slow, or down.`,
  }),
  unreachable: {
    kind: "unreachable",
    summary:
      "The browser couldn't reach the server at all. The name may not resolve, or nothing may be listening there.",
  },
  blockedLikelyCors: {
    kind: "blocked-likely-cors",
    summary:
      "The server answered, but the browser wouldn't let the app read the response. The likely cause is CORS: the server didn't allow requests from this app's origin. The browser hides the exact reason, so this is a diagnosis, not a certainty.",
  },
} as const satisfies Record<string, Diagnosis | ((timeoutMs: number) => Diagnosis)>;

/**
 * Works out why a request failed. Browsers raise the same TypeError for a
 * CORS refusal as for a server that can't be reached, so the app asks again
 * in `no-cors` mode: an opaque response proves the server is reachable,
 * which leaves CORS as the likely cause.
 */
async function diagnose(
  error: unknown,
  url: URL,
  options: TracedFetchOptions,
): Promise<{ diagnosis: Diagnosis; probed: boolean }> {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { diagnosis: diagnoses.timedOut(options.timeoutMs), probed: false };
  }
  if (!(error instanceof TypeError)) {
    throw new Error("A request failed in a way the demonstrator doesn't recognise.", {
      cause: error,
    });
  }
  try {
    await options.fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(options.timeoutMs) });
    return { diagnosis: diagnoses.blockedLikelyCors, probed: true };
  } catch {
    // The probe failing too is the evidence: the server can't be reached.
    return { diagnosis: diagnoses.unreachable, probed: true };
  }
}

function recordProbe(request: TracedRequest, diagnosis: Diagnosis, trace: Trace): void {
  trace.add({
    step: request.describe.step,
    from: request.describe.from,
    to: request.describe.to,
    purpose:
      "Ask again without reading the response, to tell a CORS refusal from a server that can't be reached.",
    provenance: "seen",
    request: { method: "GET", url: request.url.href, headers: [], body: { kind: "none" } },
    explanation:
      diagnosis.kind === "blocked-likely-cors"
        ? "The server answered this request. The browser hides the response, but it shows the server is reachable."
        : "This request failed too, so the server can't be reached from this browser.",
    specification: "https://fetch.spec.whatwg.org/#concept-request-mode",
    verdict: { kind: "as-expected" },
  });
}

function recordRequestBody(
  body: string | URLSearchParams | undefined,
  textMax: number,
): RecordedBody {
  if (body === undefined) {
    return { kind: "none" };
  }
  if (body instanceof URLSearchParams) {
    return { kind: "form", fields: [...body] };
  }
  return recordText(body, textMax);
}

function recordResponseBody(
  contentType: string | null,
  text: string,
  textMax: number,
): RecordedBody {
  if (text === "") {
    return { kind: "none" };
  }
  if (contentType !== null && /^application\/([\w.-]+\+)?json\b/i.test(contentType)) {
    try {
      return { kind: "json", value: JSON.parse(text) };
    } catch {
      // A body labelled JSON that isn't: show it as the text it is.
    }
  }
  return recordText(text, textMax);
}

function recordText(text: string, textMax: number): RecordedBody {
  return text.length > textMax
    ? { kind: "text", text: text.slice(0, textMax), truncated: true }
    : { kind: "text", text, truncated: false };
}
