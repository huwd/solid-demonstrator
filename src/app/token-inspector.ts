import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import {
  describePodTrustProblem,
  describeWebIdCheckProblem,
  type Message,
} from "../core/messages.ts";
import type { PodTrustResult } from "../core/pod-trust-check.ts";
import type { Inspection, TokenSummary } from "../core/token-inspection.ts";
import type { WebIdCheckResult } from "../core/token-webid-check.ts";

/**
 * The token inspector (outcome 3): what each token says, whether the access
 * token is bound to the app's own key, and whether the token's WebID names
 * this provider, the check the Pod will make. Only decoded claims reach
 * this view, never a token itself (decision 0005).
 */
export class TokenInspector extends LitElement {
  static override properties = {
    inspection: { attribute: false },
    webIdCheck: { attribute: false },
    podTrust: { attribute: false },
    issuer: { attribute: false },
    webId: { attribute: false },
  };

  declare inspection: Inspection | null;
  /** Null while the check is running. */
  declare webIdCheck: WebIdCheckResult | null;
  declare podTrust: PodTrustResult | "no-pod" | null;
  declare issuer: string;
  declare webId: string | null;

  static override styles = css`
    :host {
      display: block;
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
  `;

  constructor() {
    super();
    this.inspection = null;
    this.webIdCheck = null;
    this.podTrust = null;
    this.issuer = "";
    this.webId = null;
  }

  override render() {
    return html`
      <h2>What the tokens say</h2>
      <p>
        The tokens themselves are never shown, only what they claim. The ID token tells the app who
        you are. The access token is what the app will show the Pod.
      </p>
      ${this.#renderWebIdCheck()}
      ${this.#renderPodTrust()}
      ${this.inspection === null ? html`<p role="status">Reading the tokens…</p>` : this.#renderInspection(this.inspection)}
    `;
  }

  #renderWebIdCheck(): TemplateResult {
    const check = this.webIdCheck;
    if (check === null) {
      return html`<p role="status">Checking that the WebID's profile names ${this.issuer}…</p>`;
    }
    if (!check.ok) {
      return callout("problem", describeWebIdCheckProblem(check.problem, this.issuer, this.webId));
    }
    return callout("ready", {
      summary: `The WebID's profile names ${this.issuer}`,
      detail: `A Pod checks this on every request: it fetches ${this.webId} and looks for ${this.issuer} among its identity providers. The app made the same check, and the Pod should accept the token.`,
    });
  }

  #renderPodTrust(): TemplateResult | typeof nothing {
    const check = this.podTrust;
    if (this.webIdCheck === null) {
      return nothing;
    }
    if (check === "no-pod") {
      return html`<p>Your profile names no Pod, so the app has no request to check as a Pod would.</p>`;
    }
    if (check === null) {
      return html`<p role="status">Checking the token and a DPoP proof as the Pod will…</p>`;
    }
    if (!check.ok) {
      const kind = check.problem.kind === "beyond-solid" ? "warning" : "problem";
      return callout(kind, describePodTrustProblem(check.problem, this.issuer));
    }
    return callout("ready", {
      summary: "The token and proof pass the Pod's checks",
      detail: `The app fetched ${this.issuer}'s public keys and checked they signed the token, that it's from ${this.issuer}, is for Solid and hasn't expired. It checked a DPoP proof for a request to your Pod names that request, is tied to this token, and was signed with the key the token is bound to. A Pod makes the same checks on every request.`,
    });
  }

  #renderInspection(inspection: Inspection): TemplateResult {
    return html`
      ${bindingCallout(inspection)}
      ${inspection.accessToken === null ? nothing : renderToken(inspection.accessToken)}
      ${renderToken(inspection.idToken)}
    `;
  }
}

function bindingCallout(inspection: Inspection): TemplateResult {
  if (inspection.boundToAppKey === null) {
    return callout("warning", {
      summary: "The access token's claims can't be read",
      detail:
        "It isn't a JWT, so the app can't see which key it's bound to. Solid-OIDC expects access tokens to be JWTs.",
    });
  }
  if (!inspection.boundToAppKey) {
    return callout("problem", {
      summary: "The access token is bound to a different key",
      detail: `Its cnf.jkt doesn't match the thumbprint of the app's key, ${inspection.appKeyThumbprint}, so the app can't make the DPoP proofs a Pod will ask for.`,
    });
  }
  return callout("ready", {
    summary: "The access token is bound to the app's key",
    detail: `Its cnf.jkt is ${inspection.appKeyThumbprint}, the thumbprint of the app's DPoP public key. A copy of the token is no use without the private key, which the browser won't let anyone export.`,
  });
}

function renderToken(token: TokenSummary): TemplateResult {
  const rows: [string, string | null][] = [
    ["Issued by", token.issuer],
    ["WebID", token.webId],
    ["For", token.audience.length === 0 ? null : token.audience.join(", ")],
    ["App", token.clientId],
    ["Issued", token.issuedAt?.toLocaleString("en-GB") ?? null],
    ["Expires", token.expiresAt?.toLocaleString("en-GB") ?? null],
    ["Bound to key", token.keyThumbprint],
  ];
  return html`
    <h3>${token.label}</h3>
    <dl>
      ${rows.map(([name, value]) => html`<dt>${name}</dt><dd>${value ?? "Not stated"}</dd>`)}
    </dl>
  `;
}

function callout(kind: "problem" | "warning" | "ready", message: Message): TemplateResult {
  return html`
    <div class=${kind} role=${kind === "problem" ? "alert" : nothing}>
      <p class="summary">${message.summary}</p>
      <p>${message.detail}</p>
    </div>
  `;
}

customElements.define("token-inspector", TokenInspector);
