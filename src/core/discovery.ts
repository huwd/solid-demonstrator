/**
 * Discovery from start to finish: from what a person typed, through their
 * WebID profile, to every identity provider it names.
 *
 * Each step records its own trace entries. This module only decides the
 * order, and stops where a later step would have nothing to work with.
 */

import { discoverIssuer, type IssuerResult } from "./issuer.ts";
import { fetchWebIdProfile, type ProfileProblem, type WebIdProfile } from "./profile.ts";
import type { Trace } from "./trace.ts";
import type { TracedFetch } from "./traced-fetch.ts";
import { readWebId, type WebIdProblem } from "./webid.ts";

export interface ProviderFinding {
  readonly issuer: string;
  readonly result: IssuerResult;
}

export type DiscoveryResult =
  | { readonly ok: false; readonly stage: "webid"; readonly problem: WebIdProblem }
  | {
      readonly ok: false;
      readonly stage: "profile";
      /** The profile document that was asked for, which messages name. */
      readonly document: URL;
      readonly problem: ProfileProblem;
    }
  | {
      readonly ok: true;
      readonly profile: WebIdProfile;
      /** One finding per identity provider, in the order the profile gives them. */
      readonly providers: readonly ProviderFinding[];
    };

export interface DiscoveryOptions {
  readonly tracedFetch: TracedFetch;
  readonly trace: Pick<Trace, "settle">;
}

export async function discover(typed: string, options: DiscoveryOptions): Promise<DiscoveryResult> {
  const input = readWebId(typed);
  if (!input.ok) {
    return { ok: false, stage: "webid", problem: input.problem };
  }
  const profileResult = await fetchWebIdProfile(options.tracedFetch, input, options.trace);
  if (!profileResult.ok) {
    return {
      ok: false,
      stage: "profile",
      document: input.profileDocument,
      problem: profileResult.problem,
    };
  }
  const { profile } = profileResult;
  // Providers are independent of each other, so they are asked at once.
  const providers = await Promise.all(
    profile.issuers.map(async (issuer) => ({
      issuer,
      result: await discoverIssuer(options.tracedFetch, issuer, options.trace),
    })),
  );
  return { ok: true, profile, providers };
}
