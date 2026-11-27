import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Channel,
  findWebSocketService,
  listen,
  type Notification,
  readNotification,
  type Socket,
  subscribe,
  webSocketChannel,
} from "./notifications.ts";
import { createTrace, type Trace } from "./trace.ts";
import { createTracedFetch } from "./traced-fetch.ts";

const service = new URL("https://pod.example/.notifications/WebSocketChannel2023/");
const topic = new URL("https://pod.example/alice/");
const secret = "0f8e2c4a-6b1d-4e9f-a3c7-5d2b8e1f0a6c";
const receiveFrom = `wss://pod.example/.notifications/ws/${secret}`;

const newTrace = () => createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 20 });

describe("findWebSocketService", () => {
  it("finds the service offering WebSocket channels, or none", () => {
    const websocket = { url: service, channelTypes: [webSocketChannel], features: [] };
    const webhook = {
      url: new URL("https://pod.example/hooks/"),
      channelTypes: [`${webSocketChannel}x`],
      features: [],
    };
    const url = new URL("https://pod.example/.well-known/solid");
    assert.equal(
      findWebSocketService({ url, subscriptionServices: [webhook, websocket] }),
      websocket,
    );
    assert.equal(findWebSocketService({ url, subscriptionServices: [webhook] }), null);
  });
});

function setUpSubscribe(answer: (() => Response) | null) {
  const trace = newTrace();
  const sent: Request[] = [];
  const tracedFetch = createTracedFetch({
    fetch: async (input, init) => {
      sent.push(new Request(input, init));
      if (answer === null) {
        throw new TypeError("fetch failed");
      }
      return answer();
    },
    trace,
    timeoutMs: 1000,
    recordedTextMax: 100_000,
  });
  return { trace, sent, run: () => subscribe(tracedFetch, service, topic, trace) };
}

describe("subscribe", () => {
  it("asks for a WebSocket channel for the topic, and keeps where to listen", async () => {
    const { trace, sent, run } = setUpSubscribe(() =>
      Response.json({
        id: `${service.href}${secret}`,
        type: webSocketChannel,
        topic: topic.href,
        receiveFrom,
      }),
    );
    const result = await run();
    assert.deepEqual(result, {
      ok: true,
      channel: {
        id: `${service.href}${secret}`,
        topic: topic.href,
        receiveFrom: new URL(receiveFrom),
      },
    });
    const request = sent[0];
    assert.equal(request?.method, "POST");
    assert.equal(request?.headers.get("content-type"), "application/ld+json");
    assert.deepEqual(await request?.json(), {
      "@context": ["https://www.w3.org/ns/solid/notification/v1"],
      type: webSocketChannel,
      topic: topic.href,
    });
    const [entry] = trace.entries();
    assert.equal(entry?.to, "notification-service");
    assert.deepEqual(entry?.verdict, { kind: "as-expected" });
    assert.ok(!JSON.stringify(entry).includes(secret), "the capability URL is shortened");
  });

  it("keeps a channel that names no id or topic", async () => {
    const { run } = setUpSubscribe(() => Response.json({ receiveFrom: "ws://localhost:3000/ws" }));
    const result = await run();
    assert.ok(result.ok);
    assert.equal(result.channel.id, null);
    assert.equal(result.channel.topic, null);
  });

  for (const [description, answer, problem] of [
    ["a refusal", () => new Response("", { status: 403 }), { kind: "forbidden" }],
    ["a body that isn't JSON", () => new Response("<html>"), { kind: "not-json" }],
    [
      "JSON that isn't an object",
      () => Response.json("channel"),
      { kind: "not-a-channel", missing: "receiveFrom" },
    ],
    [
      "a channel without receiveFrom",
      () => Response.json({ id: "x" }),
      { kind: "not-a-channel", missing: "receiveFrom" },
    ],
    [
      "a receiveFrom that isn't a WebSocket",
      () => Response.json({ receiveFrom: "https://pod.example/ws" }),
      { kind: "not-a-channel", missing: "receiveFrom" },
    ],
  ] as const) {
    it(`explains ${description}`, async () => {
      const { trace, run } = setUpSubscribe(answer);
      assert.deepEqual(await run(), { ok: false, problem });
      assert.equal(trace.entries()[0]?.verdict.kind, "unexpected");
    });
  }

  it("reports a request that failed", async () => {
    const { run } = setUpSubscribe(null);
    const result = await run();
    assert.ok(!result.ok);
    assert.equal(result.problem.kind, "request-failed");
  });
});

describe("readNotification", () => {
  it("reads an Activity Streams notification", () => {
    assert.deepEqual(
      readNotification(
        JSON.stringify({
          "@context": ["https://www.w3.org/ns/activitystreams"],
          id: "urn:uuid:1",
          type: "https://www.w3.org/ns/activitystreams#Add",
          object: "https://pod.example/alice/note.txt",
          target: "https://pod.example/alice/",
          published: "2026-11-27T12:00:01Z",
          state: '"v2"',
        }),
      ),
      {
        type: "Add",
        object: "https://pod.example/alice/note.txt",
        target: "https://pod.example/alice/",
        published: new Date("2026-11-27T12:00:01Z"),
        state: '"v2"',
      },
    );
    assert.deepEqual(readNotification(JSON.stringify({ type: "Update", published: "soon" })), {
      type: "Update",
      object: null,
      target: null,
      published: null,
      state: null,
    });
  });

  it("ignores what isn't a notification", () => {
    for (const text of ["ping", "null", "7", JSON.stringify({ object: "x" })]) {
      assert.equal(readNotification(text), null, text);
    }
  });
});

class FakeSocket implements Socket {
  readonly url: string;
  readonly listeners = new Map<string, ((event: { data: unknown }) => void)[]>();
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data });
    }
  }
  close(): void {
    this.closed = true;
    this.emit("close");
  }
}

function setUpListen(): {
  trace: Trace;
  socket: () => FakeSocket;
  received: Notification[];
  closes: string[];
  opens: number[];
  stop: () => void;
} {
  const trace = newTrace();
  const received: Notification[] = [];
  const closes: string[] = [];
  const opens: number[] = [];
  let socket: FakeSocket | null = null;
  const channel: Channel = { id: null, topic: topic.href, receiveFrom: new URL(receiveFrom) };
  const stop = listen(
    (url) => {
      socket = new FakeSocket(url);
      return socket;
    },
    channel,
    trace,
    {
      onOpen: () => opens.push(1),
      onNotification: (notification) => received.push(notification),
      onClose: (reason) => closes.push(reason),
    },
  );
  return { trace, socket: () => socket as unknown as FakeSocket, received, closes, opens, stop };
}

describe("listen", () => {
  it("records the connection, without its secret, and each notification", () => {
    const { trace, socket, received, opens, stop } = setUpListen();
    assert.equal(socket().url, receiveFrom);
    const [connection] = trace.entries();
    assert.equal(
      connection?.request?.url,
      "wss://pod.example/.notifications/ws/0f8e2c… (36 characters)",
    );
    assert.equal(connection?.verdict.kind, "pending");

    socket().emit("open");
    assert.equal(trace.entries()[0]?.verdict.kind, "as-expected");
    assert.deepEqual(opens, [1]);

    socket().emit(
      "message",
      JSON.stringify({ type: "Update", object: "https://pod.example/alice/a" }),
    );
    socket().emit("message", "ping");
    socket().emit("message", new ArrayBuffer(1));
    assert.deepEqual(
      received.map((notification) => notification.type),
      ["Update"],
    );
    const [, update, ping, binary] = trace.entries();
    assert.equal(update?.purpose, "A notification: Update of https://pod.example/alice/a.");
    assert.equal(update?.message?.kind, "json");
    assert.equal(ping?.verdict.kind, "unexpected");
    assert.deepEqual(binary?.message, { kind: "text", text: "", truncated: false });

    stop();
    assert.equal(socket().closed, true);
    assert.equal(trace.entries().length, 4, "closing it ourselves adds nothing");
  });

  it("says when the service closes the connection", () => {
    const { trace, socket, closes } = setUpListen();
    socket().emit("open");
    socket().emit("close");
    assert.equal(trace.entries().at(-1)?.purpose, "The notification service closed the WebSocket.");
    assert.deepEqual(closes, ["closed"]);
  });

  it("explains a connection that never opened", () => {
    const { trace, socket, closes } = setUpListen();
    socket().emit("error");
    socket().emit("close");
    assert.equal(trace.entries()[0]?.verdict.kind, "failed");
    assert.deepEqual(closes, ["failed"]);
  });

  it("ignores an error once it's open", () => {
    const { trace, socket } = setUpListen();
    socket().emit("open");
    socket().emit("error");
    assert.equal(trace.entries()[0]?.verdict.kind, "as-expected");
  });

  it("works without the optional callbacks", () => {
    const trace = newTrace();
    let socket: FakeSocket | null = null;
    listen(
      (url) => {
        socket = new FakeSocket(url);
        return socket;
      },
      { id: null, topic: null, receiveFrom: new URL(receiveFrom) },
      trace,
      { onNotification: () => undefined },
    );
    const fake = socket as unknown as FakeSocket;
    fake.emit("open");
    fake.emit("message", JSON.stringify({ type: "Delete" }));
    fake.emit("close");
    assert.equal(trace.entries()[1]?.purpose, "A notification: Delete of the topic.");
  });
});
