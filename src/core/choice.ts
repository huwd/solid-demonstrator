/**
 * The person's choice of identity provider and Pod, where the profile
 * offers more than one (outcome 2). Login starts from the chosen provider,
 * and reading starts from the chosen Pod.
 */

import type { DiscoveryResult } from "./discovery.ts";

export interface Choice {
  /** The chosen identity provider's issuer, or null if none is chosen yet. */
  readonly issuer: string | null;
  /** The chosen Pod's address, or null if none is chosen yet. */
  readonly storage: string | null;
}

type Found = Extract<DiscoveryResult, { ok: true }>;

/**
 * The providers a person can choose: those whose discovery document could
 * be read. Gaps are shown as warnings, but don't stop someone trying.
 */
export function choosableIssuers(found: Found): readonly string[] {
  return found.providers.filter((finding) => finding.result.ok).map((finding) => finding.issuer);
}

/** Chooses for the person only where there's nothing to choose between. */
export function initialChoice(found: Found): Choice {
  const issuers = choosableIssuers(found);
  return {
    issuer: onlyOne(issuers),
    storage: onlyOne(found.profile.storages)?.href ?? null,
  };
}

/**
 * Applies a change from the interface, keeping the current choice for
 * anything that isn't one of the profile's own options.
 */
export function choose(
  current: Choice,
  found: Found,
  change: { readonly issuer?: string; readonly storage?: string },
): Choice {
  const issuer =
    change.issuer !== undefined && choosableIssuers(found).includes(change.issuer)
      ? change.issuer
      : current.issuer;
  const storage =
    change.storage !== undefined &&
    found.profile.storages.some((storage) => storage.href === change.storage)
      ? change.storage
      : current.storage;
  return { issuer, storage };
}

/** The list's one item, or null if it has none or several. */
function onlyOne<T>(list: readonly T[]): T | null {
  return list.find(() => list.length === 1) ?? null;
}
