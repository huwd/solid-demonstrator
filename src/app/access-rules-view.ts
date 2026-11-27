import { css, html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import {
  type AccessRules,
  type AccessRulesResult,
  type Authorization,
  describeAgent,
  describeMode,
  type Matcher,
  type Policy,
  readAccessRules,
} from "../core/access-rules.ts";
import type { Access } from "../core/container.ts";
import { describeAccessRulesProblem } from "../core/messages.ts";
import type { PodFetch } from "../core/pod-fetch.ts";
import type { Trace } from "../core/trace.ts";

/**
 * A resource's access rules, under WAC or ACP (outcome 7). They're read
 * only when the person asks, since only someone with Control access may
 * read them, and each read is a request in the timeline.
 */
export class AccessRulesView extends LitElement {
  static override properties = {
    podFetch: { attribute: false },
    trace: { attribute: false },
    resource: { attribute: false },
    rulesUrl: { attribute: false },
    access: { attribute: false },
    result: { state: true },
    reading: { state: true },
  };

  declare podFetch: PodFetch | null;
  declare trace: Pick<Trace, "settle"> | null;
  /** The resource the rules are for. */
  declare resource: URL | null;
  /** Where the Pod's Link header says the rules are. */
  declare rulesUrl: URL | null;
  declare access: Access | null;
  declare result: AccessRulesResult | null;
  declare reading: boolean;

  static override styles = css`
    :host {
      display: block;
    }
    button {
      font: inherit;
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
    this.resource = null;
    this.rulesUrl = null;
    this.access = null;
    this.result = null;
    this.reading = false;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("rulesUrl")) {
      this.result = null;
      this.reading = false;
    }
  }

  override render() {
    const { rulesUrl, access, result } = this;
    if (rulesUrl === null) {
      return html`<p>The Pod doesn't link to the access rules here, so the app can't show them.</p>`;
    }
    if (access !== null && !access.user.includes("control")) {
      return html`<p>
        You don't have Control access here, so the Pod won't show you the access rules. Reading
        them is separate from reading the resource.
      </p>`;
    }
    if (result === null) {
      return html`<p>
        <button ?disabled=${this.reading} @click=${() => this.#read(rulesUrl)}>
          ${this.reading ? "Reading the access rules…" : "Show the access rules"}
        </button>
      </p>`;
    }
    if (!result.ok) {
      const message = describeAccessRulesProblem(result.problem, rulesUrl);
      return html`<div class="problem" role="alert">
        <p class="summary">${message.summary}</p>
        <p>${message.detail}</p>
      </div>`;
    }
    return renderRules(result.rules, this.resource);
  }

  async #read(url: URL): Promise<void> {
    if (this.podFetch === null || this.trace === null) {
      return;
    }
    this.reading = true;
    const result = await readAccessRules(this.podFetch, url, this.trace);
    // Only show the rules for the resource still being looked at.
    if (this.rulesUrl === url) {
      this.result = result;
      this.reading = false;
    }
  }
}

function renderRules(rules: AccessRules, resource: URL | null): TemplateResult {
  if (rules.system === "wac") {
    return html`<section aria-label="Access rules">
      <h4>Access rules: Web Access Control</h4>
      <p>
        The Pod uses Web Access Control. The rules are in ${rules.url.href}. Each authorisation, an acl:Authorization, lets someone do something, and the Pod allows a request if any authorisation covers it.
      </p>
      <ul>
        ${rules.authorizations.map((authorization) => html`<li>${describeAuthorization(authorization, resource)}</li>`)}
      </ul>
    </section>`;
  }
  return html`<section aria-label="Access rules">
    <h4>Access rules: Access Control Policies</h4>
    <p>
      The Pod uses Access Control Policies. The access control resource is ${rules.url.href}. Each
      policy allows or denies some modes to requests that match it, and a denial wins over an
      allowance.
    </p>
    ${
      rules.policies.length === 0
        ? html`<p>It applies no policies.</p>`
        : html`<ul>
            ${rules.policies.map((policy) => html`<li>${describePolicy(policy)}</li>`)}
          </ul>`
    }
  </section>`;
}

function describeAuthorization(authorization: Authorization, resource: URL | null): string {
  const who = [
    ...authorization.agents,
    ...authorization.agentClasses.map(describeAgent),
    ...authorization.agentGroups.map((group) => `members of ${group}`),
  ];
  const where = [
    ...authorization.accessTo.map((url) => (url === resource?.href ? "this resource" : url)),
    ...authorization.defaultFor.map(
      (url) => `what's inside ${url === resource?.href ? "it" : url}, by default`,
    ),
  ];
  const through =
    authorization.origins.length === 0
      ? ""
      : `, only through apps from ${authorization.origins.join(" or ")}`;
  return `${list(authorization.modes.map(describeMode))} for ${list(who)}${through}. Applies to ${list(where)}.`;
}

function describePolicy(policy: Policy): string {
  if (!policy.definedHere) {
    return `${policy.id}, defined in another document, which the app doesn't read.`;
  }
  const effect = [
    policy.allow.length === 0 ? null : `Allows ${list(policy.allow.map(describeMode))}.`,
    policy.deny.length === 0 ? null : `Denies ${list(policy.deny.map(describeMode))}.`,
  ].filter((part) => part !== null);
  const conditions = [
    policy.allOf.length === 0 ? null : `all of: ${policy.allOf.map(describeMatcher).join("; ")}`,
    policy.anyOf.length === 0 ? null : `any of: ${policy.anyOf.map(describeMatcher).join("; ")}`,
    policy.noneOf.length === 0 ? null : `none of: ${policy.noneOf.map(describeMatcher).join("; ")}`,
  ].filter((part) => part !== null);
  const scope = policy.appliesTo.includes("members")
    ? policy.appliesTo.includes("resource")
      ? "this resource and what's inside it"
      : "what's inside this container"
    : "this resource";
  return `${effect.join(" ")} For requests matching ${
    conditions.length === 0 ? "nothing, so it has no effect" : conditions.join(", and ")
  }. Applies to ${scope}.`;
}

function describeMatcher(matcher: Matcher): string {
  const parts = [
    ...matcher.agents.map((agent) => `agent ${describeAgent(agent)}`),
    ...matcher.clients.map((client) => `app ${describeAgent(client)}`),
    ...matcher.issuers.map((issuer) => `identity provider ${describeAgent(issuer)}`),
    ...matcher.vcs.map((vc) => `credential ${vc}`),
  ];
  return parts.length === 0 ? "a matcher with no conditions" : parts.join(" and ");
}

function list(items: readonly string[]): string {
  if (items.length === 0) {
    return "nothing";
  }
  return items.length === 1
    ? (items[0] as string)
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

customElements.define("access-rules-view", AccessRulesView);
