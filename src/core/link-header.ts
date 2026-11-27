/**
 * Reading `Link` headers (RFC 8288), through which a Pod points from a
 * resource to the things about it: its storage description, its access
 * rules, and whether it's the root of a storage.
 */

export interface Link {
  readonly target: URL;
  /** Relation types, with registered ones in lower case. */
  readonly rels: readonly string[];
}

/** Every link in a header, resolved against the response's URL. Links that can't be read are skipped. */
export function parseLinkHeader(header: string | null, base: URL): Link[] {
  if (header === null) {
    return [];
  }
  const links: Link[] = [];
  for (const [, target = "", params = ""] of header.matchAll(
    /<([^>]*)>((?:\s*;(?:[^;,"]|"[^"]*")*)*)/g,
  )) {
    const url = URL.parse(target, base);
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;,\s]+))/i.exec(params);
    if (url === null || rel === null) {
      continue;
    }
    // One of the two groups matched.
    const value = (rel[1] ?? rel[2]) as string;
    const rels = value
      .split(/\s+/)
      .filter((type) => type !== "")
      // Registered relation types are case-insensitive; extension types are URLs.
      .map((type) => (type.includes(":") ? type : type.toLowerCase()));
    links.push({ target: url, rels });
  }
  return links;
}

const storageType = "http://www.w3.org/ns/pim/space#Storage";
const storageDescriptionRel = "http://www.w3.org/ns/solid/terms#storageDescription";

/** What a Pod's `Link` header says about a resource. */
export interface SolidLinks {
  /** Whether the resource is the root of a storage (Solid Protocol, section 4.1). */
  readonly isStorage: boolean;
  readonly storageDescription: URL | null;
  /** The resource holding its access rules: an ACL for WAC, or an access control resource for ACP. */
  readonly accessRules: URL | null;
}

export function readSolidLinks(header: string | null, base: URL): SolidLinks {
  const links = parseLinkHeader(header, base);
  const find = (predicate: (link: Link) => boolean) => links.find(predicate)?.target ?? null;
  return {
    isStorage: links.some((link) => link.rels.includes("type") && link.target.href === storageType),
    storageDescription: find((link) => link.rels.includes(storageDescriptionRel)),
    accessRules: find((link) => link.rels.includes("acl")),
  };
}
