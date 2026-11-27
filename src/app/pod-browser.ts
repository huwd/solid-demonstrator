import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { type Access, type ContainerResult, readContainer } from "../core/container.ts";
import { describeContainerProblem } from "../core/messages.ts";
import type { PodFetch } from "../core/pod-fetch.ts";
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
  };

  declare podFetch: PodFetch | null;
  declare trace: Pick<Trace, "settle"> | null;
  /** The storage root the person chose. */
  declare root: URL | null;
  declare current: URL | null;
  /** Null while the container is being read. */
  declare result: ContainerResult | null;

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
  `;

  constructor() {
    super();
    this.podFetch = null;
    this.trace = null;
    this.root = null;
    this.current = null;
    this.result = null;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("root") && this.root !== null) {
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
      ${this.#renderPath(root, current)}
      ${result === null ? html`<p role="status">Reading ${current.href}…</p>` : this.#renderResult(current, result)}
    `;
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
      const message = describeContainerProblem(result.problem, current);
      return html`<div class="problem" role="alert">
        <p class="summary">${message.summary}</p>
        <p>${message.detail}</p>
      </div>`;
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
                      : nameOf(item.url, current)
                  }
                  ${meta(item.size, item.modified)}
                </li>`,
              )}
            </ul>`
      }
    `;
  }

  async #open(url: URL): Promise<void> {
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    this.current = url;
    this.result = null;
    const result = await readContainer(this.podFetch, url, this.trace);
    // Only show the answer for the folder still being looked at.
    if (this.current === url) {
      this.result = result;
    }
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
