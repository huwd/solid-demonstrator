/**
 * Notifications (outcome 8), with the Solid Notifications Protocol's
 * WebSocketChannel2023:
 *
 * 1. the storage description names a subscription service for the channel
 * 2. the app subscribes, as the logged-in person, naming the topic: the
 *    resource or container to watch
 * 3. the service answers with a channel, whose `receiveFrom` is the
 *    WebSocket address to listen at
 * 4. each change to the topic arrives over that WebSocket as an Activity
 *    Streams notification, such as an Update
 *
 * A WebSocket can't go through the traced fetch, so this step records the
 * connection and each notification itself, through the redaction module.
 */

import type { PodFetch } from "./pod-fetch.ts";
import { readStatusProblem } from "./pod-read.ts";
import { redactCapabilityUrl, redactMessage } from "./redaction.ts";
import type { StorageDescription, SubscriptionService } from "./storage-description.ts";
import type { Diagnosis, Trace } from "./trace.ts";

const notify = "http://www.w3.org/ns/solid/notifications#";
export const webSocketChannel = `${notify}WebSocketChannel2023`;
const specification = "https://solidproject.org/TR/websocket-channel-2023";

/** The service offering WebSocket channels, if the storage has one. */
export function findWebSocketService(description: StorageDescription): SubscriptionService | null {
  return (
    description.subscriptionServices.find((service) =>
      service.channelTypes.includes(webSocketChannel),
    ) ?? null
  );
}

export interface Channel {
  readonly id: string | null;
  readonly topic: string | null;
  readonly receiveFrom: URL;
}

export type SubscribeProblem =
  | { readonly kind: "request-failed"; readonly diagnosis: Diagnosis }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not-found" }
  | { readonly kind: "http-error"; readonly status: number }
  | { readonly kind: "not-json" }
  | { readonly kind: "not-a-channel"; readonly missing: string };

export type SubscribeResult =
  | { readonly ok: true; readonly channel: Channel }
  | { readonly ok: false; readonly problem: SubscribeProblem };

export async function subscribe(
  podFetch: PodFetch,
  service: URL,
  topic: URL,
  trace: Pick<Trace, "settle">,
): Promise<SubscribeResult> {
  const response = await podFetch({
    describe: {
      step: "subscribe",
      from: "app",
      to: "notification-service",
      purpose: `Subscribe to changes to ${topic.href}, over a WebSocket.`,
      explanation:
        "The storage description named this subscription service. The app asks it, as the logged-in person, for a WebSocketChannel2023 channel for the topic. The service checks the person may read the topic, and answers with the address to listen at, receiveFrom. Anyone with that address can listen, so the timeline shortens it.",
      specification,
    },
    url: service,
    method: "POST",
    headers: { "content-type": "application/ld+json", accept: "application/ld+json" },
    body: JSON.stringify({
      "@context": ["https://www.w3.org/ns/solid/notification/v1"],
      type: webSocketChannel,
      topic: topic.href,
    }),
  });
  if (!response.ok) {
    return { ok: false, problem: { kind: "request-failed", diagnosis: response.diagnosis } };
  }
  const refuse = (problem: SubscribeProblem, actual: string): SubscribeResult => {
    trace.settle(response.entry.id, { kind: "unexpected", expected: "a channel", actual });
    return { ok: false, problem };
  };
  const failed = readStatusProblem(response.status);
  if (failed !== null) {
    return refuse(failed.problem, failed.actual);
  }
  let body: unknown;
  try {
    body = JSON.parse(response.text);
  } catch {
    return refuse({ kind: "not-json" }, "a body that isn't JSON");
  }
  const channel = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  const receiveFrom =
    typeof channel["receiveFrom"] === "string" ? URL.parse(channel["receiveFrom"]) : null;
  if (receiveFrom === null || !/^wss?:$/.test(receiveFrom.protocol)) {
    return refuse(
      { kind: "not-a-channel", missing: "receiveFrom" },
      "a channel without a WebSocket address to listen at",
    );
  }
  trace.settle(response.entry.id, { kind: "as-expected" });
  return {
    ok: true,
    channel: {
      id: typeof channel["id"] === "string" ? channel["id"] : null,
      topic: typeof channel["topic"] === "string" ? channel["topic"] : null,
      receiveFrom,
    },
  };
}

/** One notification, as Activity Streams describes it. */
export interface Notification {
  /** Such as Create, Update, Delete, Add or Remove. */
  readonly type: string;
  readonly object: string | null;
  /** For Add and Remove, the container. */
  readonly target: string | null;
  readonly published: Date | null;
  /** The resource's new ETag, where the service gives it. */
  readonly state: string | null;
}

/** Reads a notification message; null if it isn't one. */
export function readNotification(text: string): Notification | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const string = (name: string) => {
    const field = record[name];
    return typeof field === "string" ? field : null;
  };
  const type = string("type");
  if (type === null) {
    return null;
  }
  const published = string("published");
  return {
    // Some services send the full IRI, such as https://www.w3.org/ns/activitystreams#Update.
    type: type.replace(/^.*[#/]/, ""),
    object: string("object"),
    target: string("target"),
    published:
      published === null || Number.isNaN(Date.parse(published)) ? null : new Date(published),
    state: string("state"),
  };
}

/** The parts of a browser WebSocket the step uses, so tests can stand in for it. */
export interface Socket {
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  close(): void;
}

export interface ChannelEvents {
  readonly onOpen?: () => void;
  readonly onNotification: (notification: Notification) => void;
  readonly onClose?: (reason: "failed" | "closed") => void;
}

/**
 * Listens at the channel's address. Records the connection, and each
 * notification, in the trace. Returns a function that closes it.
 */
export function listen(
  openSocket: (url: string) => Socket,
  channel: Channel,
  trace: Pick<Trace, "add" | "settle">,
  events: ChannelEvents,
): () => void {
  const shown = redactCapabilityUrl(channel.receiveFrom.href);
  const connection = trace.add({
    step: "listen",
    from: "app",
    to: "notification-service",
    purpose: "Open the WebSocket the channel named, to receive notifications.",
    provenance: "seen",
    request: {
      method: "GET",
      url: shown,
      headers: [["upgrade", "websocket"]],
      body: { kind: "none" },
    },
    explanation:
      "The browser opens the connection and hides the handshake, so the app sees only that it opened. No token is sent: holding the address is what lets the app listen.",
    specification,
  });
  let opened = false;
  let closing = false;
  const socket = openSocket(channel.receiveFrom.href);
  socket.addEventListener("open", () => {
    opened = true;
    trace.settle(connection.id, { kind: "as-expected" });
    events.onOpen?.();
  });
  socket.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : "";
    const notification = readNotification(text);
    const message = redactMessage(
      notification === null
        ? { kind: "text", text, truncated: false }
        : { kind: "json", value: JSON.parse(text) },
    );
    trace.add({
      step: "notification",
      from: "notification-service",
      to: "app",
      purpose:
        notification === null
          ? "A message that isn't a notification."
          : `A notification: ${notification.type} of ${notification.object ?? "the topic"}.`,
      provenance: "seen",
      message: message.value,
      decodedTokens: message.decodedTokens,
      specification,
      verdict:
        notification === null
          ? {
              kind: "unexpected",
              expected: "an Activity Streams notification",
              actual: "something else",
            }
          : { kind: "as-expected" },
    });
    if (notification !== null) {
      events.onNotification(notification);
    }
  });
  socket.addEventListener("error", () => {
    if (!opened) {
      trace.settle(connection.id, {
        kind: "failed",
        diagnosis: {
          kind: "unreachable",
          summary: "The WebSocket didn't open. The browser doesn't say why.",
        },
      });
    }
  });
  socket.addEventListener("close", () => {
    if (opened && !closing) {
      trace.add({
        step: "listen",
        from: "notification-service",
        to: "app",
        purpose: "The notification service closed the WebSocket.",
        provenance: "seen",
        specification,
        verdict: {
          kind: "unexpected",
          expected: "the connection to stay open",
          actual: "it closed",
        },
      });
    }
    events.onClose?.(opened ? "closed" : "failed");
  });
  return () => {
    closing = true;
    socket.close();
  };
}
