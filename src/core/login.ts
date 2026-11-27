/**
 * Login, step 1: preparing to send the person to their identity provider.
 *
 * Nothing is fetched here. The step makes the secrets that tie the login
 * together, and the address the browser will be sent to. The secrets are
 * kept until the person comes back:
 *
 * - the PKCE code verifier, whose hash goes in the address now, so only this
 *   app can exchange the code that comes back
 * - `state`, which must come back unchanged, so the app knows the response
 *   is to its own request
 * - `nonce`, which the identity provider puts in the ID token, tying the
 *   token to this login
 *
 * See docs/decisions/0014-oauth4webapi-for-oauth-steps.md.
 */

import {
  calculatePKCECodeChallenge,
  generateKeyPair,
  generateRandomCodeVerifier,
  generateRandomNonce,
  generateRandomState,
} from "oauth4webapi";
import type { IssuerConfiguration } from "./issuer.ts";

/** How the app identifies itself to this identity provider. */
export interface LoginClient {
  readonly clientId: string;
  /** Where the identity provider sends the person back to. */
  readonly redirectUri: string;
}

/** What the app keeps until the person comes back. */
export interface PendingLogin extends LoginClient {
  readonly issuer: string;
  /** Whether the response must name the issuer in `iss` (RFC 9207). */
  readonly issParameterSupported: boolean;
  /** The address the person was sent to, recorded when they come back. */
  readonly authorizationUrl: string;
  readonly codeVerifier: string;
  readonly state: string;
  readonly nonce: string;
}

export interface PreparedLogin {
  /** The identity provider's address for this login, with every parameter. */
  readonly authorizationUrl: URL;
  readonly pending: PendingLogin;
}

/** The scopes the app asks for: an ID token, and the WebID in the tokens. */
export const loginScope = "openid webid";

export async function prepareLogin(
  configuration: Pick<
    IssuerConfiguration,
    "issuer" | "authorizationEndpoint" | "issParameterSupported"
  >,
  client: LoginClient,
): Promise<PreparedLogin> {
  const codeVerifier = generateRandomCodeVerifier();
  const state = generateRandomState();
  const nonce = generateRandomNonce();

  // Parameters are added to any the endpoint already has.
  const authorizationUrl = new URL(configuration.authorizationEndpoint);
  const parameters = authorizationUrl.searchParams;
  parameters.set("response_type", "code");
  parameters.set("client_id", client.clientId);
  parameters.set("redirect_uri", client.redirectUri);
  parameters.set("scope", loginScope);
  parameters.set("code_challenge", await calculatePKCECodeChallenge(codeVerifier));
  parameters.set("code_challenge_method", "S256");
  parameters.set("state", state);
  parameters.set("nonce", nonce);
  // Always ask the person, so they see what the app is asking for.
  parameters.set("prompt", "consent");

  return {
    authorizationUrl,
    pending: {
      issuer: configuration.issuer,
      issParameterSupported: configuration.issParameterSupported,
      authorizationUrl: authorizationUrl.href,
      ...client,
      codeVerifier,
      state,
      nonce,
    },
  };
}

/**
 * The key that DPoP proofs are signed with: ES256, which every identity
 * provider the demonstrator has met supports. The private key can't be
 * exported, so even code running in the page can't copy it (decision 0008).
 */
export function generateDpopKeyPair(): Promise<CryptoKeyPair> {
  return generateKeyPair("ES256", { extractable: false });
}
