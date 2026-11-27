import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import type { DiscoveryResult, ProviderFinding } from "../core/discovery.ts";
import {
  describeGap,
  describeIssuerProblem,
  describeProfileGaps,
  describeProfileProblem,
  type Message,
} from "../core/messages.ts";

/**
 * What discovery found: the profile's statements and each identity
 * provider's readiness for login. Everything shown comes from servers the
 * person chose, so it is only ever rendered as text, and only HTTP and
 * HTTPS addresses become links.
 */
export class DiscoveryResults extends LitElement {
  static override properties = { result: { attribute: false } };

  declare result: DiscoveryResult | undefined;

  static override styles = css`
    :host {
      display: block;
    }
    h2,
    h3 {
      margin: 1.5rem 0 0.5rem;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.25rem 1rem;
    }
    dt {
      font-weight: bold;
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    ul {
      padding-left: 1.25rem;
    }
    .problem,
    .warning,
    .ready {
      border-left: 0.3rem solid;
      padding: 0.25rem 0 0.25rem 1rem;
      margin: 0.75rem 0;
    }
    .problem {
      border-color: light-dark(#b00020, #ff8a80);
    }
    .warning {
      border-color: light-dark(#8a5a00, #ffd180);
    }
    .ready {
      border-color: light-dark(#00703c, #69f0ae);
    }
    .summary {
      font-weight: bold;
      margin: 0;
    }
    .detail {
      margin: 0.25rem 0 0;
    }
  `;

  constructor() {
    super();
    this.result = undefined;
  }

  override render() {
    const result = this.result;
    if (result === undefined) {
      return nothing;
    }
    if (!result.ok) {
      // A WebID problem is shown beside the form, not here.
      return result.stage === "profile"
        ? callout("problem", describeProfileProblem(result.problem, result.document))
        : nothing;
    }
    const { profile, providers } = result;
    return html`
      <h2>What the profile says</h2>
      <dl>
        ${profile.name === null ? nothing : html`<dt>Name</dt><dd>${profile.name}</dd>`}
        <dt>WebID</dt>
        <dd>${profile.webId.href}</dd>
        <dt>Read from</dt>
        <dd>${link(profile.document)}</dd>
        <dt>Pods</dt>
        <dd>
          ${
            profile.storages.length === 0
              ? "None named"
              : html`<ul>${profile.storages.map((storage) => html`<li>${link(storage)}</li>`)}</ul>`
          }
        </dd>
      </dl>
      ${describeProfileGaps(profile).map((gap) => callout("warning", gap))}
      ${
        providers.length === 0
          ? nothing
          : html`
            <h2>Identity providers</h2>
            ${providers.map(renderProvider)}
          `
      }
    `;
  }
}

function renderProvider(finding: ProviderFinding): TemplateResult {
  const heading = html`<h3>${finding.issuer}</h3>`;
  if (!finding.result.ok) {
    return html`${heading}${callout("problem", describeIssuerProblem(finding.result.problem, finding.issuer))}`;
  }
  const { configuration } = finding.result;
  const identifies = configuration.clientIdDocuments
    ? "It accepts a Client ID Document, a URL it can check, to identify this app."
    : configuration.registrationEndpoint !== null
      ? "It identifies apps by dynamic client registration, where the app describes itself."
      : "";
  if (configuration.gaps.length === 0) {
    return html`${heading}${callout("ready", { summary: "Ready for login", detail: identifies })}`;
  }
  return html`
    ${heading}
    <div class="warning">
      <p class="summary">Login may not work with this provider</p>
      <ul>
        ${configuration.gaps.map((gap) => {
          const message = describeGap(gap);
          return html`<li><strong>${message.summary}.</strong> ${message.detail}</li>`;
        })}
      </ul>
    </div>
  `;
}

function callout(kind: "problem" | "warning" | "ready", message: Message): TemplateResult {
  return html`
    <div class=${kind} role=${kind === "problem" ? "alert" : nothing}>
      <p class="summary">${message.summary}</p>
      ${message.detail === "" ? nothing : html`<p class="detail">${message.detail}</p>`}
    </div>
  `;
}

/** A link for web addresses only, so a profile can't supply a javascript: URL. */
function link(url: URL): TemplateResult | string {
  return url.protocol === "https:" || url.protocol === "http:"
    ? html`<a href=${url.href} rel="noreferrer">${url.href}</a>`
    : url.href;
}

customElements.define("discovery-results", DiscoveryResults);
