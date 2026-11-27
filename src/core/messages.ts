/**
 * What the demonstrator tells a person when discovery finds a problem.
 *
 * Each message has a short summary, which says what is wrong, and a detail,
 * which says why it matters or what to check. They are written for a
 * developer who is new to Solid, in plain British English.
 */

import type { ContainerProblem } from "./container.ts";
import type { IssuerGap, IssuerProblem } from "./issuer.ts";
import type { ReturnProblem } from "./login-return.ts";
import type { ReadProblem } from "./pod-read.ts";
import type { BeyondSolidRule, PodTrustProblem } from "./pod-trust-check.ts";
import type { ProfileProblem, WebIdProfile } from "./profile.ts";
import type { RegistrationProblem } from "./registration.ts";
import type { ExchangeProblem } from "./token-exchange.ts";
import type { WebIdCheckProblem } from "./token-webid-check.ts";
import type { WebIdProblem } from "./webid.ts";

export interface Message {
  readonly summary: string;
  readonly detail: string;
}

const exampleWebId = "https://alice.example/profile#me";

export function describeWebIdProblem(problem: WebIdProblem): Message {
  switch (problem) {
    case "empty":
      return {
        summary: "Enter a WebID",
        detail: `A WebID is a URL that names a person, such as ${exampleWebId}.`,
      };
    case "not-a-url":
      return {
        summary: "Enter the WebID as a full URL",
        detail: `Start with https://, as in ${exampleWebId}.`,
      };
    case "not-https":
      return {
        summary: "A WebID must start with https://",
        detail:
          "HTTPS stops anyone between you and the profile changing what it says. HTTP is accepted only on localhost, for exploring a local test stack.",
      };
    case "has-credentials":
      return {
        summary: "Remove the username and password from the WebID",
        detail: "A WebID is public, and the demonstrator never sends credentials in an address.",
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${String(unhandled)}`);
    }
  }
}

export function describeProfileProblem(problem: ProfileProblem, document: URL): Message {
  switch (problem.kind) {
    case "request-failed":
      return { summary: "The profile couldn't be fetched", detail: problem.diagnosis.summary };
    case "http-error":
      return problem.status === 404
        ? {
            summary: "There's no profile at this address",
            detail: `${document.href} returned 404 Not Found. Check the WebID is typed correctly.`,
          }
        : {
            summary: "The profile's server returned an error",
            detail: `${document.href} returned ${problem.status} instead of the profile.`,
          };
    case "not-turtle":
      return {
        summary: "The profile isn't in Turtle",
        detail: `The demonstrator asked for Turtle (text/turtle), which every Solid profile must offer, but got ${problem.contentType ?? "a response with no content type"}.`,
      };
    case "too-large":
      return {
        summary: "The response is too large to be a profile",
        detail: `It's ${problem.length.toLocaleString("en-GB")} characters long. Profiles are small, so the demonstrator stops at a million characters.`,
      };
    case "unparseable":
      return { summary: "The profile's Turtle can't be read", detail: problem.message };
    case "webid-not-described":
      return {
        summary: "The profile doesn't mention this WebID",
        detail: `${document.href} says nothing about the WebID you entered. Check the part after the #: many WebIDs end in #me.`,
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${JSON.stringify(unhandled)}`);
    }
  }
}

export function describeIssuerProblem(problem: IssuerProblem, issuer: string): Message {
  switch (problem.kind) {
    case "not-fetchable":
      return {
        summary: `${issuer} can't be contacted`,
        detail:
          "An identity provider must be an https:// address with no ? or # part, so the demonstrator doesn't try it.",
      };
    case "request-failed":
      return { summary: `${issuer} couldn't be reached`, detail: problem.diagnosis.summary };
    case "http-error":
      return {
        summary: `${issuer} has no discovery document`,
        detail: `Its /.well-known/openid-configuration returned ${problem.status}, so it may not be an identity provider.`,
      };
    case "too-large":
    case "not-json":
      return {
        summary: `${issuer} returned something other than a discovery document`,
        detail: "A discovery document is a small JSON object describing the provider.",
      };
    case "issuer-mismatch":
      return describeMismatch(issuer, problem.stated);
    case "bad-endpoint":
      return {
        summary: `${issuer} gives an unusable ${problem.field}`,
        detail: `Every endpoint the login uses must be an https:// address, and ${problem.field} isn't.`,
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${JSON.stringify(unhandled)}`);
    }
  }
}

function describeMismatch(issuer: string, stated: unknown): Message {
  const why =
    "They must match character for character, so tokens from one provider can't be passed off as another's.";
  if (typeof stated !== "string") {
    return {
      summary: `${issuer} doesn't say which issuer it is`,
      detail: `Its discovery document has no issuer to compare with the profile's. ${why}`,
    };
  }
  if (stated.replace(/\/$/, "") === issuer.replace(/\/$/, "")) {
    return {
      summary: "The profile and the provider disagree about a trailing slash",
      detail: `The profile names ${issuer}, but the provider calls itself ${stated}. ${why} The profile needs to use the provider's form.`,
    };
  }
  return {
    summary: `${issuer} calls itself something else`,
    detail: `Its discovery document says it is ${stated}. ${why}`,
  };
}

export function describeGap(gap: IssuerGap): Message {
  switch (gap) {
    case "no-webid-scope":
      return {
        summary: "It doesn't list the webid scope",
        detail: "The webid scope asks the provider to put the WebID in the tokens it issues.",
      };
    case "no-pkce-s256":
      return {
        summary: "It doesn't list PKCE with S256",
        detail: "PKCE stops another app using the login code if it's intercepted.",
      };
    case "no-dpop-es256":
      return {
        summary: "It doesn't list DPoP with ES256",
        detail: "DPoP ties each token to a key that only this browser holds.",
      };
    case "no-way-to-identify-the-app":
      return {
        summary: "It offers no way for this app to identify itself",
        detail:
          "It accepts neither Client ID Documents nor dynamic client registration, so the login can't say which app is asking.",
      };
    // Unreachable while the switch covers every gap.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = gap;
      throw new Error(`No message for ${String(unhandled)}`);
    }
  }
}

/** What a profile that reads correctly still lacks, if anything. */
export function describeProfileGaps(profile: WebIdProfile): readonly Message[] {
  const gaps: Message[] = [];
  if (profile.issuers.length === 0) {
    gaps.push({
      summary: "The profile names no identity provider",
      detail:
        "Without solid:oidcIssuer, no provider is trusted to log anyone in as this WebID, so the demonstrator can't go on to login.",
    });
  }
  if (profile.storages.length === 0) {
    gaps.push({
      summary: "The profile names no Pod",
      detail:
        "Without pim:storage, there's nowhere listed to read or write this person's data. Some servers list the Pod elsewhere, which the demonstrator doesn't yet look for.",
    });
  }
  return gaps;
}

/** Why the app won't use what the identity provider sent back. */
export function describeReturnProblem(problem: ReturnProblem, issuer: string): Message {
  switch (problem.kind) {
    case "state-mismatch":
      return {
        summary: "The response doesn't match the login the app started",
        detail:
          "Its state differs from the one the app sent, so it may not be a response to this app's request. The app won't use it.",
      };
    case "iss-missing":
      return {
        summary: `${issuer} didn't say it sent the response`,
        detail: `${issuer} says it names itself in every response, but this one has no iss, so the app can't tell where it came from.`,
      };
    case "iss-mismatch":
      return {
        summary: "The response names a different identity provider",
        detail: `You chose ${issuer}, but the response says it's from ${problem.stated}. The app won't use a code from a provider you didn't choose.`,
      };
    case "refused":
      return problem.error === "access_denied"
        ? {
            summary: "You didn't allow the app",
            detail: `${issuer} says the app wasn't allowed to act for you, so nothing was shared.`,
          }
        : {
            summary: `${issuer} returned an error`,
            detail: `It said ${problem.error}${problem.description === null ? "" : `: ${problem.description}`}.`,
          };
    case "no-code":
      return {
        summary: `${issuer} sent no code`,
        detail: "Without a code, the app can't go on to ask for tokens.",
      };
    case "rejected":
      return {
        summary: "The response didn't pass oauth4webapi's checks",
        detail: problem.message,
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Why the app couldn't get tokens for the code. */
export function describeExchangeProblem(problem: ExchangeProblem, issuer: string): Message {
  switch (problem.kind) {
    case "request-failed":
      return {
        summary: `${issuer}'s token endpoint couldn't be reached`,
        detail: problem.diagnosis.summary,
      };
    case "refused":
      return problem.error === "invalid_grant"
        ? {
            summary: `${issuer} wouldn't exchange the code`,
            detail:
              "It said invalid_grant. A code works once, and only for a short time, so it may have expired or been used already. Log in again.",
          }
        : {
            summary: `${issuer} wouldn't exchange the code`,
            detail: `It answered ${problem.status} with ${problem.error}${problem.description === null ? "" : `: ${problem.description}`}.`,
          };
    case "not-dpop":
      return {
        summary: "The access token isn't bound to the app's key",
        detail: `${issuer} sent a token of type ${problem.tokenType}, which anyone holding a copy could use. Solid-OIDC requires DPoP, so the app won't use it.`,
      };
    case "invalid-response":
      return {
        summary: "The tokens didn't pass oauth4webapi's checks",
        detail: problem.message,
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Why a Pod would refuse the token, because its WebID doesn't vouch for its issuer. */
export function describeWebIdCheckProblem(
  problem: WebIdCheckProblem,
  issuer: string,
  webId: string | null,
): Message {
  const consequence = "A Pod would refuse this token, so reading and writing won't work.";
  switch (problem.kind) {
    case "no-webid":
      return {
        summary: "The token names no WebID",
        detail: `${issuer} didn't say which WebID you logged in as. ${consequence}`,
      };
    case "bad-webid":
      return {
        summary: "The token's WebID can't be checked",
        detail: `${webId} isn't a WebID the app can fetch: ${describeWebIdProblem(problem.problem).summary}. ${consequence}`,
      };
    case "profile":
      return {
        summary: "The token's WebID profile couldn't be read",
        detail: `${describeProfileProblem(problem.problem, problem.document).summary}. ${consequence}`,
      };
    case "issuer-not-named":
      return {
        summary: `The profile doesn't name ${issuer}`,
        detail: `${
          problem.named.length === 0
            ? "The profile names no identity provider."
            : `The profile names ${problem.named.join(", ")}, but the token is from ${issuer}.`
        } ${consequence}`,
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Why the app couldn't register with the identity provider. */
export function describeRegistrationProblem(problem: RegistrationProblem, issuer: string): Message {
  switch (problem.kind) {
    case "request-failed":
      return {
        summary: `${issuer}'s registration endpoint couldn't be reached`,
        detail: problem.diagnosis.summary,
      };
    case "refused":
      return {
        summary: `${issuer} wouldn't register the app`,
        detail:
          problem.error === null
            ? `It answered ${problem.status}, without saying why.`
            : `It answered ${problem.status} with ${problem.error}${problem.description === null ? "" : `: ${problem.description}`}.`,
      };
    case "no-client-id":
      return {
        summary: `${issuer} didn't give the app a client_id`,
        detail:
          "It said the registration worked, but without a client_id the app has nothing to log in with.",
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Why the Pod wouldn't let the app read something, container or not. */
export function describeReadProblem(problem: ReadProblem, url: URL): Message {
  switch (problem.kind) {
    case "request-failed":
      return { summary: `${url.href} couldn't be fetched`, detail: problem.diagnosis.summary };
    case "unauthenticated":
      return {
        summary: "The Pod didn't accept the login",
        detail:
          "It answered 401, which means it doesn't know who's asking: the token may have expired, or the Pod may not trust the identity provider that issued it. Logging in again gets a new token.",
      };
    case "forbidden":
      return {
        summary: "You aren't allowed to read this",
        detail:
          "The Pod answered 403. It knows who you are, but its access rules don't let you read this. Logging in proved who you are; what you may do is up to the Pod's owner.",
      };
    case "not-found":
      return {
        summary: "There's nothing at this address",
        detail: `The Pod answered 404 for ${url.href}.`,
      };
    case "http-error":
      return {
        summary: "The Pod returned an error",
        detail: `It answered ${problem.status} for ${url.href}.`,
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Why a container in the Pod couldn't be listed. */
export function describeContainerProblem(problem: ContainerProblem, url: URL): Message {
  switch (problem.kind) {
    case "request-failed":
    case "unauthenticated":
    case "forbidden":
    case "not-found":
    case "http-error":
      return describeReadProblem(problem, url);
    case "not-turtle":
      return {
        summary: "The Pod didn't send a listing the app can read",
        detail: `It sent ${problem.contentType === null ? "no content type" : problem.contentType}, but the app asked for Turtle, which every Solid Pod must offer for a container.`,
      };
    case "unparseable":
      return {
        summary: "The listing couldn't be read",
        detail: `It isn't valid Turtle: ${problem.message}`,
      };
    case "not-a-container":
      return {
        summary: "This isn't a container",
        detail: `${url.href} doesn't describe itself as an LDP container, so it has nothing to list.`,
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Why the app's repeat of the Pod's checks of the token and proof didn't pass. */
export function describePodTrustProblem(problem: PodTrustProblem, issuer: string): Message {
  switch (problem.kind) {
    case "issuer":
      return {
        summary: "The app couldn't find the provider's keys",
        detail: `${describeIssuerProblem(problem.problem, issuer).summary}. A Pod reads the same configuration to find the keys that check a token, so it may refuse this one.`,
      };
    case "keys-unavailable":
      return {
        summary: "The provider's keys couldn't be fetched",
        detail: `${problem.reason} Without them, neither the app nor a Pod can check the token's signature, so a Pod may refuse it.`,
      };
    case "beyond-solid":
      return {
        summary: "The token doesn't meet RFC 9068, but Solid doesn't require that",
        detail: `${ruleDescriptions[problem.rule]} The app checks tokens with oauth4webapi, which follows RFC 9068's profile for access tokens and asks more than Solid-OIDC does. A Solid Pod need not refuse the token for this. The library stops at the first rule a token breaks, so the signature and the DPoP proof weren't checked.`,
      };
    case "refused":
      return {
        summary: "A Pod would refuse this token",
        detail: `The check failed: ${problem.message}. A Pod makes the same check, so reading and writing won't work.`,
      };
    // Unreachable while the switch covers every problem.
    /* node:coverage ignore next 4 */
    default: {
      const unhandled: never = problem;
      throw new Error(`No message for ${JSON.stringify(unhandled)}`);
    }
  }
}

const ruleDescriptions: Record<BeyondSolidRule, string> = {
  typ: "Its header doesn't give its type as at+jwt.",
  jti: "It has no jti, an identifier for the token.",
  sub: "It has no sub, as a string, naming who it's about.",
};
