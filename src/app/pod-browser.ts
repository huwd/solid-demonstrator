import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from "lit";
import { type Access, type ContainerResult, readContainer } from "../core/container.ts";
import {
  describeContainerProblem,
  describeReadProblem,
  describeStorageDescriptionProblem,
  describeWriteProblem,
  type Message,
} from "../core/messages.ts";
import { acpExample, wacExample } from "../core/narrowing.ts";
import type { PodFetch } from "../core/pod-fetch.ts";
import {
  createResource,
  deleteResource,
  ensureScratchFolder,
  isInside,
  updateResource,
  type WriteProblem,
} from "../core/pod-write.ts";
import { type ResourceResult, readResource } from "../core/resource.ts";
import {
  localName,
  readStorageDescription,
  type StorageDescriptionResult,
} from "../core/storage-description.ts";
import type { Trace } from "../core/trace.ts";
import "./access-rules-view.ts";

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
    webId: { attribute: false },
    clientId: { attribute: false },
    scratch: { state: true },
    allowElsewhere: { state: true },
    editing: { state: true },
    confirmingDelete: { state: true },
    writeProblem: { state: true },
    busy: { state: true },
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
  declare webId: string | null;
  /** The access token's client_id, for the example rules. */
  declare clientId: string | null;
  /** The scratch folder, once the person has asked to use it (decision 0017). */
  declare scratch:
    | { readonly ok: true; readonly url: URL; readonly created: boolean }
    | { readonly ok: false; readonly problem: WriteProblem }
    | null;
  /** The app's own safeguard: off after each login. */
  declare allowElsewhere: boolean;
  declare editing: boolean;
  /** The resource the person has asked to delete, awaiting confirmation. */
  declare confirmingDelete: URL | null;
  declare writeProblem: { readonly url: URL; readonly problem: WriteProblem } | null;
  declare busy: boolean;

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
    textarea {
      width: 100%;
      min-height: 8rem;
      font-family: monospace;
    }
    label {
      display: block;
      margin-top: 0.5rem;
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
    this.webId = null;
    this.clientId = null;
    this.scratch = null;
    this.allowElsewhere = false;
    this.editing = false;
    this.confirmingDelete = null;
    this.writeProblem = null;
    this.busy = false;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("root") && this.root !== null) {
      this.description = null;
      this.scratch = null;
      this.allowElsewhere = false;
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
      ${this.#renderWriting(root)}
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
    const { contains, access, links } = result.container;
    return html`
      <p>${describeAccess(access)}</p>
      ${this.#renderRules(current, links.accessRules, access)}
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
      ${this.#renderCreate(current)}
      ${
        current.href === this.root?.href || !this.#canWrite(current)
          ? nothing
          : this.#renderDelete(current, null, "Delete this folder")
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
    const { contentType, text, size, etag, access, links } = resource.resource;
    return html`
      ${back}
      <h3>${nameOf(url, container)}</h3>
      <p>
        ${contentType ?? "No content type"}${size === null ? "" : `, ${size.toLocaleString("en-GB")} bytes`}.
        ${etag === null ? "The Pod sent no ETag." : `Its ETag, this version's name, is ${etag}.`}
      </p>
      <p>${describeAccess(access)}</p>
      ${this.#renderRules(url, links.accessRules, access)}
      ${
        text === null
          ? html`<p>The app shows only text, so it doesn't show this resource's content.</p>`
          : this.editing
            ? nothing
            : html`<pre tabindex="0" aria-label="Content of ${nameOf(url, container)}">${text}</pre>`
      }
      ${this.#renderChanges(url, resource.resource.contentType, text, etag)}
    `;
  }

  #canWrite(url: URL): boolean {
    return this.allowElsewhere || (this.scratch?.ok === true && isInside(url, this.scratch.url));
  }

  #renderWriting(root: URL): TemplateResult {
    const scratch = this.scratch;
    return html`<section aria-label="Changing your Pod">
      <h3>Changing your Pod</h3>
      <p>
        Logging in doesn't limit what the app could change: the Pod lets it do whatever you may.
        The app therefore writes in a folder of its own, solid-demonstrator/, unless you allow it to
        change things elsewhere.
      </p>
      ${
        scratch === null
          ? html`<p><button ?disabled=${this.busy} @click=${() => this.#useScratch(root)}>Use the scratch folder</button></p>`
          : scratch.ok
            ? html`<p>
                ${scratch.created ? "The app created" : "The app found"}
                <button class="link" @click=${() => this.#open(scratch.url)}>${scratch.url.href}</button>.
              </p>`
            : problem(describeWriteProblem(scratch.problem, new URL("solid-demonstrator/", root)))
      }
      <label>
        <input
          type="checkbox"
          .checked=${this.allowElsewhere}
          @change=${(event: Event) => {
            this.allowElsewhere = (event.target as HTMLInputElement).checked;
          }}
        />
        Allow changes outside the scratch folder, until you log out
      </label>
      <p>
        This switch is the app's own safeguard. The Pod would allow these changes anyway, unless
        its access rules say otherwise.
      </p>
      ${this.#renderNarrowing(root)}
    </section>`;
  }

  #renderNarrowing(root: URL): TemplateResult {
    const subject = {
      webId: this.webId ?? "",
      clientId: this.clientId,
      origin: location.origin,
      folder: new URL("solid-demonstrator/", root),
    };
    const acp = acpExample(subject);
    return html`<details>
      <summary>Narrow this app's access in your Pod</summary>
      <p>
        The Pod decides every request from its access rules, so that's where to limit this app.
        The token names it as ${this.clientId ?? "no client"}. These examples let only this app,
        acting as you, read and write the scratch folder. They narrow the app only if no other rule
        lets you in through any app, so rules elsewhere need to name the apps they're for too. The
        app never changes access rules itself.
      </p>
      <h4>Access Control Policies</h4>
      ${
        acp === null
          ? html`<p>
              The app was registered with your provider for this login, so its client identifier
              changes, and ACP has nothing stable to name.
            </p>`
          : html`<pre tabindex="0" aria-label="Example ACP rules">${acp}</pre>`
      }
      <h4>Web Access Control</h4>
      <p>
        acl:origin limits the rule to apps served from ${location.origin}. Check your server
        enforces acl:origin before relying on it.
      </p>
      <pre tabindex="0" aria-label="Example WAC rules">${wacExample(subject)}</pre>
    </details>`;
  }

  #renderCreate(container: URL): TemplateResult {
    if (!this.#canWrite(container)) {
      return html`<p>
        To create something here, use the scratch folder, or allow changes outside it.
      </p>`;
    }
    return html`<form aria-label="Create" @submit=${(event: SubmitEvent) => this.#create(event, container)}>
      <h4>Create something here</h4>
      <label>Name <input name="name" required pattern="[^/]+" /></label>
      <label>
        Kind
        <select name="kind">
          <option value="text/plain">Text file</option>
          <option value="text/turtle">Turtle file</option>
          <option value="folder">Folder</option>
        </select>
      </label>
      <label>Content <textarea name="content"></textarea></label>
      <p><button ?disabled=${this.busy}>Create</button></p>
      ${this.#renderWriteProblem(container)}
    </form>`;
  }

  #renderChanges(
    url: URL,
    contentType: string | null,
    text: string | null,
    etag: string | null,
  ): TemplateResult {
    if (!this.#canWrite(url)) {
      return html`<p>
        This is outside the scratch folder. Allow changes outside it to edit or delete it.
      </p>`;
    }
    const edit =
      text === null
        ? nothing
        : etag === null
          ? html`<p>
              The Pod sent no ETag, so the app won't edit this: it couldn't stop the edit
              overwriting someone else's change.
            </p>`
          : this.editing
            ? html`<form
                aria-label="Edit"
                @submit=${(event: SubmitEvent) => this.#save(event, url, etag, contentType ?? "text/plain")}
              >
                <label>Content <textarea name="content" .value=${text}></textarea></label>
                <p>
                  <button ?disabled=${this.busy}>Save</button>
                  <button type="button" @click=${() => {
                    this.editing = false;
                  }}>Cancel</button>
                </p>
              </form>`
            : html`<p><button @click=${() => {
                this.editing = true;
                this.writeProblem = null;
              }}>Edit</button></p>`;
    return html`${edit}${this.#renderDelete(url, etag, "Delete")}${this.#renderWriteProblem(url)}`;
  }

  #renderDelete(url: URL, etag: string | null, label: string): TemplateResult {
    if (this.confirmingDelete?.href !== url.href) {
      return html`<p><button @click=${() => {
        this.confirmingDelete = url;
        this.writeProblem = null;
      }}>${label}</button></p>`;
    }
    return html`<div role="alertdialog" aria-label="Confirm delete">
      <p>Delete ${url.href}? This can't be undone.</p>
      <p>
        <button ?disabled=${this.busy} @click=${() => this.#delete(url, etag)}>Yes, delete it</button>
        <button @click=${() => {
          this.confirmingDelete = null;
        }}>Cancel</button>
      </p>
    </div>`;
  }

  #renderWriteProblem(url: URL): TemplateResult | typeof nothing {
    const failed = this.writeProblem;
    return failed === null || failed.url.href !== url.href
      ? nothing
      : problem(describeWriteProblem(failed.problem, failed.url));
  }

  async #useScratch(root: URL): Promise<void> {
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    this.busy = true;
    this.scratch = await ensureScratchFolder(this.podFetch, root, this.trace);
    this.busy = false;
    if (this.scratch.ok) {
      await this.#open(this.scratch.url);
    }
  }

  async #create(event: SubmitEvent, container: URL): Promise<void> {
    event.preventDefault();
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    const form = new FormData(event.target as HTMLFormElement);
    const name = String(form.get("name"));
    const kind = String(form.get("kind"));
    const folder = kind === "folder";
    const url = new URL(`${encodeURIComponent(name)}${folder ? "/" : ""}`, container);
    this.busy = true;
    const result = await createResource(
      this.podFetch,
      url,
      folder
        ? { contentType: "text/turtle", body: "" }
        : { contentType: kind, body: String(form.get("content")) },
      this.trace,
    );
    this.busy = false;
    if (!result.ok) {
      this.writeProblem = { url: container, problem: result.problem };
      return;
    }
    this.writeProblem = null;
    await this.#open(container);
  }

  async #save(event: SubmitEvent, url: URL, etag: string, contentType: string): Promise<void> {
    event.preventDefault();
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    const content = String(new FormData(event.target as HTMLFormElement).get("content"));
    this.busy = true;
    const result = await updateResource(
      this.podFetch,
      url,
      etag,
      { contentType, body: content },
      this.trace,
    );
    this.busy = false;
    if (!result.ok) {
      this.writeProblem = { url, problem: result.problem };
      return;
    }
    this.editing = false;
    this.writeProblem = null;
    await this.#view(url);
  }

  async #delete(url: URL, etag: string | null): Promise<void> {
    if (this.podFetch === null || this.trace === null || this.current === null) {
      return;
    }
    this.busy = true;
    const result = await deleteResource(this.podFetch, url, etag, this.trace);
    this.busy = false;
    this.confirmingDelete = null;
    if (!result.ok) {
      this.writeProblem = { url, problem: result.problem };
      return;
    }
    this.writeProblem = null;
    // After deleting a folder, go up to the folder that held it.
    const parent = url.href === this.current.href ? new URL("../", url) : this.current;
    await this.#open(parent);
  }

  #renderRules(resource: URL, rulesUrl: URL | null, access: Access | null): TemplateResult {
    return html`<access-rules-view
      .podFetch=${this.podFetch}
      .trace=${this.trace}
      .resource=${resource}
      .rulesUrl=${rulesUrl}
      .access=${access}
    ></access-rules-view>`;
  }

  async #view(url: URL): Promise<void> {
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    this.viewing = url;
    this.resource = null;
    this.editing = false;
    this.confirmingDelete = null;
    const resource = await readResource(this.podFetch, url, this.trace);
    if (this.viewing === url) {
      this.resource = resource;
    }
  }

  #closeResource(): void {
    this.viewing = null;
    this.resource = null;
    this.editing = false;
    this.confirmingDelete = null;
    this.writeProblem = null;
  }

  async #open(url: URL): Promise<void> {
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    this.current = url;
    this.result = null;
    this.viewing = null;
    this.resource = null;
    this.editing = false;
    this.confirmingDelete = null;
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
