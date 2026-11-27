import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localName, readStorageDescription } from "./storage-description.ts";
import { createTrace } from "./trace.ts";
import { createTracedFetch } from "./traced-fetch.ts";

const url = new URL("https://pod.example/.well-known/solid");

function setUp(answer: () => Response) {
  const trace = createTrace({ now: () => new Date("2026-11-27T12:00:00Z"), entriesMax: 10 });
  const tracedFetch = createTracedFetch({
    fetch: async () => answer(),
    trace,
    timeoutMs: 1000,
    recordedTextMax: 100_000,
  });
  return { trace, run: () => readStorageDescription(tracedFetch, url, trace) };
}

const turtle = (body: string) => () =>
  new Response(body, { headers: { "content-type": "text/turtle" } });

describe("readStorageDescription", () => {
  it("finds the subscription services and the channels each offers", async () => {
    const { trace, run } = setUp(
      turtle(`@prefix notify: <http://www.w3.org/ns/solid/notifications#> .
        <> a <http://www.w3.org/ns/pim/space#Storage> ;
          notify:subscription </.notifications/WebSocketChannel2023/>, </.notifications/WebhookChannel2023/> .
        </.notifications/WebSocketChannel2023/> notify:channelType notify:WebSocketChannel2023 ;
          notify:feature notify:accept, notify:endAt .
        </.notifications/WebhookChannel2023/> notify:channelType notify:WebhookChannel2023 .`),
    );
    const result = await run();
    assert.ok(result.ok);
    assert.deepEqual(
      result.description.subscriptionServices.map((service) => [
        service.url.href,
        service.channelTypes.map(localName),
        service.features.map(localName),
      ]),
      [
        [
          "https://pod.example/.notifications/WebSocketChannel2023/",
          ["WebSocketChannel2023"],
          ["accept", "endAt"],
        ],
        ["https://pod.example/.notifications/WebhookChannel2023/", ["WebhookChannel2023"], []],
      ],
    );
    assert.equal(trace.entries()[0]?.step, "readStorageDescription");
    assert.deepEqual(trace.entries()[0]?.verdict, { kind: "as-expected" });
  });

  it("reads a description that offers no notifications", async () => {
    const { run } = setUp(turtle("<> a <http://www.w3.org/ns/pim/space#Storage> ."));
    const result = await run();
    assert.ok(result.ok);
    assert.deepEqual(result.description.subscriptionServices, []);
  });

  it("explains a description it can't read", async () => {
    const { run } = setUp(() => new Response("", { status: 404 }));
    const result = await run();
    assert.ok(!result.ok);
    assert.deepEqual(result.problem, { kind: "not-found" });
  });
});

describe("localName", () => {
  it("keeps the last part of an IRI, or the whole IRI if there's none", () => {
    assert.equal(
      localName("http://www.w3.org/ns/solid/notifications#WebSocketChannel2023"),
      "WebSocketChannel2023",
    );
    assert.equal(localName("https://example.org/types/Thing"), "Thing");
    assert.equal(localName("https://example.org/"), "https://example.org/");
  });
});
