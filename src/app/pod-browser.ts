import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { type Access, type ContainerResult, readContainer } from "../core/container.ts";
import {
  describeContainerProblem,
  describeReadProblem,
  describeStorageDescriptionProblem,
  type Message,
} from "../core/messages.ts";
import type { PodFetch } from "../core/pod-fetch.ts";
import { type ResourceResult, readResource } from "../core/resource.ts";
import {
  localName,
  readStorageDescription,
  type StorageDescriptionResult,
} from "../core/storage-description.ts";
import type { Trace } from "../core/trace.ts";

/**
 * The Pod browser (outcome 5): the logged-in person's Pod, one container
 * at a time, read with their token. Every listing is a traced request, so
 * the timeline shows each one, with its DPoP proof.
 */
export class PodBrowser extends LitElement {
  static override properties = {
    podFetch: { attribute: false },
    trace: { attribute: false },
    root: { attribute: false },
    current: { state: true },
    result: { state: true },
    viewing: { state: true },
    resource: { state: true },
    description: { state: true },
  };

  declare podFetch: PodFetch | null;
  declare trace: Pick<Trace, "settle"> | null;
  /** The storage root the person chose. */
  declare root: URL | null;
  declare current: URL | null;
  /** Null while the container is being read. */
  declare result: ContainerResult | null;
  /** The resource opened from the current container, if one is. */
  declare viewing: URL | null;
  /** Null while the resource is being read. */
  declare resource: ResourceResult | null;
  /** What the storage offers; "none" if the Pod links to no description; null until read. */
  declare description: StorageDescriptionResult | "none" | null;

  static override styles = css`
    :host {
      display: block;
    }
    ol.path {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      list-style: none;
      padding: 0;
    }
    ol.path li:not(:last-child)::after {
      content: "/";
      margin-left: 0.25rem;
    }
    ul.contents {
      padding-left: 1.25rem;
    }
    button.link {
      font: inherit;
      color: LinkText;
      background: none;
      border: none;
      padding: 0;
      text-decoration: underline;
      cursor: pointer;
    }
    .meta {
      color: GrayText;
    }
    .problem {
      border-left: 0.3rem solid light-dark(#b00020, #ff8a80);
      padding: 0.25rem 0 0.25rem 1rem;
    }
    .summary {
      font-weight: bold;
      margin: 0;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 30rem;
      overflow: auto;
      padding: 0.5rem;
      border: 1px solid GrayText;
    }
  `;

  constructor() {
    super();
    this.podFetch = null;
    this.trace = null;
    this.root = null;
    this.current = null;
    this.result = null;
    this.viewing = null;
    this.resource = null;
    this.description = null;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("root") && this.root !== null) {
      this.description = null;
      void this.#open(this.root);
    }
  }

  override render() {
    const { root, current, result } = this;
    if (root === null || current === null) {
      return html`<h2>Your Pod</h2>
        <p>Your profile names no Pod, so there's nothing to read.</p>`;
    }
    return html`
      <h2>Your Pod</h2>
      <p>
        Each folder is read from ${root.origin} as you, with your access token and a fresh DPoP
        proof. The timeline shows every request.
      </p>
      ${this.#renderDescription()}
      ${this.#renderPath(root, current)}
      ${
        this.viewing !== null
          ? this.#renderResource(this.viewing, current)
          : result === null
            ? html`<p role="status">Reading ${current.href}…</p>`
            : this.#renderResult(current, result)
      }
    `;
  }

  #renderDescription(): TemplateResult | typeof nothing {
    const description = this.description;
    if (description === null) {
      return nothing;
    }
    if (description === "none") {
      return html`<p>The Pod doesn't link to a storage description, so the app can't tell what it offers, such as notifications.</p>`;
    }
    if (!description.ok) {
      return problem(
        describeStorageDescriptionProblem(description.problem, this.root ?? new URL("about:blank")),
      );
    }
    const services = description.description.subscriptionServices;
    return html`<section aria-label="What this Pod offers">
      <h3>What this Pod offers</h3>
      <p>
        The Pod describes its storage at ${description.description.url.href}.
        ${
          services.length === 0
            ? "It names no notification services."
            : "It offers notifications through:"
        }
      </p>
      ${
        services.length === 0
          ? nothing
          : html`<ul>
              ${services.map(
                (service) => html`<li>
                  ${service.url.href}:
                  ${service.channelTypes.length === 0 ? "no channel type stated" : service.channelTypes.map(localName).join(", ")}
                </li>`,
              )}
            </ul>`
      }
    </section>`;
  }

  #renderPath(root: URL, current: URL): TemplateResult {
    // From the storage root down to the current container.
    const steps: URL[] = [root];
    const below = current.href
      .slice(root.href.length)
      .split("/")
      .filter((part) => part !== "");
    for (const part of below) {
      steps.push(new URL(`${part}/`, steps.at(-1)));
    }
    return html`<nav aria-label="Where you are">
      <ol class="path">
        ${steps.map((step, index) =>
          index === steps.length - 1
            ? html`<li aria-current="location">${nameOf(step, root)}</li>`
            : html`<li><button class="link" @click=${() => this.#open(step)}>${nameOf(step, root)}</button></li>`,
        )}
      </ol>
    </nav>`;
  }

  #renderResult(current: URL, result: ContainerResult): TemplateResult {
    if (!result.ok) {
      return problem(describeContainerProblem(result.problem, current));
    }
    const { contains, access } = result.container;
    return html`
      <p>${describeAccess(access)}</p>
      ${
        contains.length === 0
          ? html`<p>This folder is empty.</p>`
          : html`<ul class="contents">
              ${contains.map(
                (item) => html`<li>
                  ${
                    item.isContainer
                      ? html`<button class="link" @click=${() => this.#open(item.url)}>
                          ${nameOf(item.url, current)}
                        </button>`
                      : html`<button class="link" @click=${() => this.#view(item.url)}>
                          ${nameOf(item.url, current)}
                        </button>`
                  }
                  ${meta(item.size, item.modified)}
                </li>`,
              )}
            </ul>`
      }
    `;
  }

  #renderResource(url: URL, container: URL): TemplateResult {
    const back = html`<p>
      <button class="link" @click=${() => this.#closeResource()}>Back to ${nameOf(container, this.root ?? container)}</button>
    </p>`;
    const resource = this.resource;
    if (resource === null) {
      return html`${back}<p role="status">Reading ${url.href}…</p>`;
    }
    if (!resource.ok) {
      return html`${back}${problem(describeReadProblem(resource.problem, url))}`;
    }
    const { contentType, text, size, etag, access } = resource.resource;
    return html`
      ${back}
      <h3>${nameOf(url, container)}</h3>
      <p>
        ${contentType ?? "No content type"}${size === null ? "" : `, ${size.toLocaleString("en-GB")} bytes`}.
        ${etag === null ? "The Pod sent no ETag." : `Its ETag, this version's name, is ${etag}.`}
      </p>
      <p>${describeAccess(access)}</p>
      ${
        text === null
          ? html`<p>The app shows only text, so it doesn't show this resource's content.</p>`
          : html`<pre tabindex="0" aria-label="Content of ${nameOf(url, container)}">${text}</pre>`
      }
    `;
  }

  async #view(url: URL): Promise<void> {
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    this.viewing = url;
    this.resource = null;
    const resource = await readResource(this.podFetch, url, this.trace);
    if (this.viewing === url) {
      this.resource = resource;
    }
  }

  #closeResource(): void {
    this.viewing = null;
    this.resource = null;
  }

  async #open(url: URL): Promise<void> {
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    this.current = url;
    this.result = null;
    this.viewing = null;
    this.resource = null;
    const result = await readContainer(this.podFetch, url, this.trace);
    // Only show the answer for the folder still being looked at.
    if (this.current === url) {
      this.result = result;
    }
    // The storage root links to the description; read it once.
    if (url === this.root && this.description === null && result.ok) {
      await this.#describe(result.container.links.storageDescription);
    }
  }

  async #describe(url: URL | null): Promise<void> {
    if (url === null) {
      this.description = "none";
      return;
    }
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    this.description = await readStorageDescription(this.podFetch, url, this.trace);
  }
}

/** A name for a resource, relative to the container it's listed in. */
function nameOf(url: URL, base: URL): string {
  if (url.href === base.href) {
    return url.pathname === "/"
      ? url.host
      : decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
  }
  const relative = url.href.startsWith(base.href) ? url.href.slice(base.href.length) : url.href;
  return decodeURIComponent(relative);
}

function problem(message: Message): TemplateResult {
  return html`<div class="problem" role="alert">
    <p class="summary">${message.summary}</p>
    <p>${message.detail}</p>
  </div>`;
}

function describeAccess(access: Access | null): string {
  if (access === null) {
    return "The app can't tell what you may do here: the Pod either sent no WAC-Allow header, or didn't expose it to other sites with CORS, so the browser hid it.";
  }
  const modes = access.user.length === 0 ? "nothing" : access.user.join(", ");
  const everyone = access.public.length === 0 ? "nothing" : access.public.join(", ");
  return `Here you may: ${modes}. Everyone may: ${everyone}. The Pod says so in its WAC-Allow header.`;
}

function meta(size: number | null, modified: Date | null): TemplateResult | typeof nothing {
  const parts = [
    size === null ? null : `${size.toLocaleString("en-GB")} bytes`,
    modified === null ? null : `changed ${modified.toLocaleString("en-GB")}`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? nothing : html`<span class="meta">(${parts.join(", ")})</span>`;
}

customElements.define("pod-browser", PodBrowser);
