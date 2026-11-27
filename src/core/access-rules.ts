/**
 * Reading a resource's access rules, under either access control system
 * a Solid Pod may use (outcome 7):
 *
 * - Web Access Control (WAC): an ACL document of `acl:Authorization`s,
 *   each granting modes to agents for a resource, or by default for what a
 *   container holds.
 * - Access Control Policies (ACP): an access control resource whose
 *   access controls apply policies, each allowing or denying modes to
 *   requests that match its matchers.
 *
 * Both are found from the resource's `Link: rel="acl"` header. The app
 * tells them apart by what the document says it is, and assumes neither
 * (decision 0003). Only someone with Control access may read them.
 */

import type { Quad } from "n3";
import type { PodFetch } from "./pod-fetch.ts";
import { readTurtle, type TurtleProblem } from "./pod-read.ts";
import type { Trace } from "./trace.ts";

const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const acl = "http://www.w3.org/ns/auth/acl#";
export const acp = "http://www.w3.org/ns/solid/acp#";

/** A WAC authorization. Modes, agent classes and the like are full IRIs. */
export interface Authorization {
  readonly id: string;
  readonly modes: readonly string[];
  readonly agents: readonly string[];
  readonly agentClasses: readonly string[];
  readonly agentGroups: readonly string[];
  /** Apps, by origin, that the authorization is limited to. */
  readonly origins: readonly string[];
  readonly accessTo: readonly string[];
  /** Containers whose contents the authorization applies to, unless they have rules of their own. */
  readonly defaultFor: readonly string[];
}

/** An ACP matcher: a request matches if it meets every attribute given. */
export interface Matcher {
  readonly id: string;
  readonly agents: readonly string[];
  readonly clients: readonly string[];
  readonly issuers: readonly string[];
  readonly vcs: readonly string[];
}

export interface Policy {
  readonly id: string;
  /** Whether it applies to the resource, to the contents of a container, or both. */
  readonly appliesTo: readonly ("resource" | "members")[];
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly allOf: readonly Matcher[];
  readonly anyOf: readonly Matcher[];
  readonly noneOf: readonly Matcher[];
  /** False if the document only names the policy, which is defined elsewhere. */
  readonly definedHere: boolean;
}

export type AccessRules =
  | { readonly system: "wac"; readonly url: URL; readonly authorizations: readonly Authorization[] }
  | { readonly system: "acp"; readonly url: URL; readonly policies: readonly Policy[] };

export type AccessRulesProblem = TurtleProblem | { readonly kind: "unrecognised" };

export type AccessRulesResult =
  | { readonly ok: true; readonly rules: AccessRules }
  | { readonly ok: false; readonly problem: AccessRulesProblem };

export async function readAccessRules(
  podFetch: PodFetch,
  url: URL,
  trace: Pick<Trace, "settle">,
): Promise<AccessRulesResult> {
  const response = await podFetch({
    describe: {
      step: "readAccessRules",
      from: "app",
      to: "pod",
      purpose: "Read the resource's access rules, which only someone with Control access may do.",
      explanation:
        "The Pod linked to the rules with rel=\"acl\". Under Web Access Control they're an ACL document of authorisations (acl:Authorization). Under Access Control Policies they're an access control resource of policies. The Pod decides every request from these rules, not from the login.",
      specification: "https://solidproject.org/TR/protocol#authorization",
    },
    url,
    headers: { accept: "text/turtle" },
  });
  const read = readTurtle(response, trace, "200 with the access rules, as Turtle");
  if (!read.ok) {
    return read;
  }
  const rules = interpret(read.quads, read.response.url);
  if (rules === null) {
    trace.settle(read.response.entry.id, {
      kind: "unexpected",
      expected: "WAC authorizations or an ACP access control resource",
      actual: "rules in neither form",
    });
    return { ok: false, problem: { kind: "unrecognised" } };
  }
  trace.settle(read.response.entry.id, { kind: "as-expected" });
  return { ok: true, rules };
}

function interpret(quads: readonly Quad[], url: URL): AccessRules | null {
  const objects = (subject: string, predicate: string) => [
    ...new Set(
      quads
        .filter((quad) => quad.subject.value === subject && quad.predicate.value === predicate)
        .map((quad) => quad.object.value),
    ),
  ];
  const subjects = (predicate: string, object?: string) => [
    ...new Set(
      quads
        .filter(
          (quad) =>
            quad.predicate.value === predicate &&
            (object === undefined || quad.object.value === object),
        )
        .map((quad) => quad.subject.value),
    ),
  ];

  const controls = (predicate: string) =>
    subjects(predicate).flatMap((resource) => objects(resource, predicate));
  const isAcp =
    subjects(rdfType, `${acp}AccessControlResource`).length > 0 ||
    controls(`${acp}accessControl`).length > 0 ||
    controls(`${acp}memberAccessControl`).length > 0;
  if (isAcp) {
    const scopes = new Map<string, Set<"resource" | "members">>();
    for (const [predicate, scope] of [
      [`${acp}accessControl`, "resource"],
      [`${acp}memberAccessControl`, "members"],
    ] as const) {
      for (const control of controls(predicate)) {
        for (const policy of objects(control, `${acp}apply`)) {
          scopes.set(policy, (scopes.get(policy) ?? new Set()).add(scope));
        }
      }
    }
    const matcher = (id: string): Matcher => ({
      id,
      agents: objects(id, `${acp}agent`),
      clients: objects(id, `${acp}client`),
      issuers: objects(id, `${acp}issuer`),
      vcs: objects(id, `${acp}vc`),
    });
    const policies = [...scopes].map(([id, appliesTo]): Policy => {
      const allow = objects(id, `${acp}allow`);
      const deny = objects(id, `${acp}deny`);
      const allOf = objects(id, `${acp}allOf`).map(matcher);
      const anyOf = objects(id, `${acp}anyOf`).map(matcher);
      const noneOf = objects(id, `${acp}noneOf`).map(matcher);
      return {
        id,
        appliesTo: [...appliesTo].sort(),
        allow,
        deny,
        allOf,
        anyOf,
        noneOf,
        definedHere: [allow, deny, allOf, anyOf, noneOf].some((list) => list.length > 0),
      };
    });
    return { system: "acp", url, policies };
  }

  const authorizations = subjects(rdfType, `${acl}Authorization`).map(
    (id): Authorization => ({
      id,
      modes: objects(id, `${acl}mode`),
      agents: objects(id, `${acl}agent`),
      agentClasses: objects(id, `${acl}agentClass`),
      agentGroups: objects(id, `${acl}agentGroup`),
      origins: objects(id, `${acl}origin`),
      accessTo: objects(id, `${acl}accessTo`),
      defaultFor: objects(id, `${acl}default`),
    }),
  );
  return authorizations.length === 0 ? null : { system: "wac", url, authorizations };
}

const agentNames: Record<string, string> = {
  "http://xmlns.com/foaf/0.1/Agent": "everyone",
  [`${acl}AuthenticatedAgent`]: "anyone logged in",
  [`${acp}PublicAgent`]: "everyone",
  [`${acp}AuthenticatedAgent`]: "anyone logged in",
  [`${acp}CreatorAgent`]: "whoever created the resource",
  [`${acp}OwnerAgent`]: "the Pod's owner",
  [`${acp}PublicClient`]: "any app",
  [`${acp}PublicIssuer`]: "any identity provider",
};

/** A plain name for a well-known agent, client or issuer class, or the IRI itself. */
export function describeAgent(iri: string): string {
  return agentNames[iri] ?? iri;
}

/** A mode, such as acl:Read, as a lower-case word: read. */
export function describeMode(iri: string): string {
  return iri.replace(/^.*[#/]/, "").toLowerCase();
}
