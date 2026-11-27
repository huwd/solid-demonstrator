/**
 * A fictional Pod for the browser tests, at https://pod.example/alice/.
 *
 * It answers as the Solid Protocol says a Pod must: it refuses requests
 * without a DPoP-bound token and proof, lists containers from what they
 * hold, and honours `If-Match` and `If-None-Match` on writes. Tests can
 * give a resource a fixed answer, such as a 403, or change one as
 * someone else would.
 */

import type { Page, Request, Route, WebSocketRoute } from "@playwright/test";

export const pod = "https://pod.example/alice/";
export const storageDescription = "https://pod.example/.well-known/solid";
export const subscriptionService = "https://pod.example/.notifications/WebSocketChannel2023/";
const listenAt = "wss://pod.example/.notifications/ws/";

const cors = { "access-control-allow-origin": "*" };

export interface Answer {
  readonly status?: number;
  readonly body?: string;
  readonly wacAllow?: string;
  readonly contentType?: string;
  readonly etag?: string;
  /** The Link header; by default, the storage description's, and the root's type. */
  readonly link?: string;
  /** A status to answer writes with, such as 403. */
  readonly writeStatus?: number;
}

export interface FictionalPod {
  /** The requests the Pod accepted. */
  readonly requests: readonly Request[];
  /** Changes a resource as someone else would, giving it a new ETag. */
  readonly change: (url: string, body: string) => void;
  /** What the Pod holds at a URL, if anything. */
  readonly holds: (url: string) => Answer | undefined;
  /** The subscriptions the notification service accepted, by topic. */
  readonly subscriptions: readonly string[];
}

export async function serveFictionalPod(
  page: Page,
  initial: Readonly<Record<string, Answer>> = {},
  description?: string,
): Promise<FictionalPod> {
  const resources = new Map<string, Answer>(Object.entries(initial));
  const requests: Request[] = [];
  let version = 0;
  const nextEtag = () => `"v${++version}"`;
  const subscriptions: string[] = [];
  /** Each channel's topic, by the identifier in its address. */
  const channels = new Map<string, string>();
  const sockets: { readonly topic: string; readonly socket: WebSocketRoute }[] = [];

  /** Tells whoever watches the resource, or the container holding it. */
  const announce = (url: string, change: Change, etag: string | null) => {
    const container = url.replace(/[^/]+\/?$/, "");
    for (const { topic, socket } of sockets) {
      const type = activity(topic, url, container, change);
      if (type !== null) {
        socket.send(JSON.stringify(notification(type, url, container, etag)));
      }
    }
  };

  const children = (container: string) =>
    [...resources.keys()].filter((url) => {
      if (!url.startsWith(container) || url === container) {
        return false;
      }
      const rest = url.slice(container.length);
      return rest.indexOf("/") === -1 || rest.indexOf("/") === rest.length - 1;
    });
  const exists = (url: string) => url === pod || resources.has(url) || children(url).length > 0;

  const listing = (container: string) => {
    const contained = children(container);
    return `<> a <http://www.w3.org/ns/ldp#BasicContainer>${
      contained.length === 0
        ? ""
        : ` ; <http://www.w3.org/ns/ldp#contains> ${contained.map((url) => `<${url}>`).join(", ")}`
    } .`;
  };

  const headersFor = (url: string, answer: Answer) => ({
    ...cors,
    "content-type": answer.contentType ?? "text/turtle",
    // The browser hides these from the app unless the Pod exposes them, as real Pods do.
    "access-control-expose-headers": "WAC-Allow, ETag, Link",
    link:
      answer.link ??
      [
        `<${storageDescription}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        ...(url === pod ? ['<http://www.w3.org/ns/pim/space#Storage>; rel="type"'] : []),
      ].join(", "),
    ...(answer.etag === undefined ? {} : { etag: answer.etag }),
    ...(answer.wacAllow === undefined ? {} : { "wac-allow": answer.wacAllow }),
  });

  const read = (route: Route, url: string, answer: Answer) =>
    exists(url)
      ? route.fulfill({
          status: answer.status ?? 200,
          headers: headersFor(url, answer),
          body: answer.body ?? (url.endsWith("/") ? listing(url) : ""),
        })
      : route.fulfill({ status: 404, headers: cors, body: "" });

  const versionRefusal = (url: string, answer: Answer, ifMatch: string | undefined) =>
    ifMatch !== undefined && (!exists(url) || ifMatch !== answer.etag) ? 412 : null;

  const deleteRefusal = (url: string) => {
    if (!exists(url)) {
      return 404;
    }
    return url.endsWith("/") && children(url).length > 0 ? 409 : null;
  };

  /** The status a write is refused with, or null if the Pod would make it. */
  const refusal = (
    method: string,
    url: string,
    answer: Answer,
    headers: Record<string, string>,
  ): number | null => {
    const refused = answer.writeStatus ?? versionRefusal(url, answer, headers["if-match"]);
    if (refused !== null) {
      return refused;
    }
    if (method === "PUT") {
      return headers["if-none-match"] === "*" && exists(url) ? 412 : null;
    }
    return method === "DELETE" ? deleteRefusal(url) : 405;
  };

  const write = (route: Route, url: string, answer: Answer) => {
    const request = route.request();
    const status = refusal(request.method(), url, answer, request.headers());
    if (status !== null) {
      return route.fulfill({ status, headers: cors, body: "" });
    }
    if (request.method() === "DELETE") {
      resources.delete(url);
      announce(url, "Delete", null);
      return route.fulfill({ status: 204, headers: cors, body: "" });
    }
    const created = !exists(url);
    const etag = nextEtag();
    // A container's representation is always its listing, whatever was sent.
    resources.set(
      url,
      url.endsWith("/")
        ? { ...answer, etag }
        : {
            ...answer,
            contentType: request.headers()["content-type"] ?? "application/octet-stream",
            body: request.postData() ?? "",
            etag,
          },
    );
    announce(url, created ? "Create" : "Update", etag);
    return route.fulfill({
      status: created ? 201 : 205,
      headers: { ...cors, etag, "access-control-expose-headers": "ETag" },
      body: "",
    });
  };

  const handle = (route: Route) => {
    const request = route.request();
    const headers = request.headers();
    // A Pod refuses a request without a DPoP-bound token and a proof.
    if (!headers["authorization"]?.startsWith("DPoP ") || headers["dpop"] === undefined) {
      return route.fulfill({ status: 401, headers: cors, body: "" });
    }
    requests.push(request);
    const url = request.url();
    const answer = resources.get(url) ?? {};
    return request.method() === "GET" ? read(route, url, answer) : write(route, url, answer);
  };

  await page.route(`${pod}**`, handle);
  await page.route(storageDescription, (route) =>
    route.fulfill({
      headers: { ...cors, "content-type": "text/turtle" },
      body:
        description ??
        `@prefix notify: <http://www.w3.org/ns/solid/notifications#> .
        <> notify:subscription </.notifications/WebSocketChannel2023/> .
        </.notifications/WebSocketChannel2023/> notify:channelType notify:WebSocketChannel2023 .`,
    }),
  );

  await page.route(subscriptionService, async (route) => {
    const request = route.request();
    if (!request.headers()["authorization"]?.startsWith("DPoP ")) {
      return route.fulfill({ status: 401, headers: cors, body: "" });
    }
    const { topic } = request.postDataJSON() as { topic: string };
    subscriptions.push(topic);
    const id = crypto.randomUUID();
    channels.set(id, topic);
    return route.fulfill({
      headers: { ...cors, "content-type": "application/ld+json" },
      body: JSON.stringify({
        "@context": ["https://www.w3.org/ns/solid/notification/v1"],
        id: `${subscriptionService}${id}`,
        type: "http://www.w3.org/ns/solid/notifications#WebSocketChannel2023",
        topic,
        receiveFrom: `${listenAt}${id}`,
      }),
    });
  });
  await page.routeWebSocket(new RegExp(`^${listenAt.replace(/[.]/g, "\\.")}`), (socket) => {
    const topic = channels.get(socket.url().slice(listenAt.length));
    if (topic === undefined) {
      void socket.close({ code: 4404, reason: "No such channel" });
      return;
    }
    sockets.push({ topic, socket });
  });

  return {
    subscriptions,
    requests,
    change: (url, body) => {
      const current = resources.get(url) ?? {};
      const etag = nextEtag();
      resources.set(url, { ...current, body, etag });
      announce(url, "Update", etag);
    },
    holds: (url) => resources.get(url),
  };
}

type Change = "Create" | "Update" | "Delete";

/** What a watcher of the topic hears about a change: the change itself, or an Add or Remove for its container. */
function activity(topic: string, url: string, container: string, change: Change): string | null {
  if (topic === url) {
    return change;
  }
  if (topic !== container || change === "Update") {
    return null;
  }
  return change === "Delete" ? "Remove" : "Add";
}

function notification(type: string, url: string, container: string, etag: string | null) {
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://www.w3.org/ns/solid/notification/v1",
    ],
    id: `urn:uuid:${crypto.randomUUID()}`,
    type,
    object: url,
    ...(type === "Add" || type === "Remove" ? { target: container } : {}),
    ...(etag === null ? {} : { state: etag }),
    published: new Date().toISOString(),
  };
}
