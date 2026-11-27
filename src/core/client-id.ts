/**
 * The app's Client ID Document: how it tells an identity provider who it
 * is (decision 0009). The `client_id` is the document's own URL, so an
 * identity provider can fetch it and check that the app's redirect is one
 * the document lists.
 *
 * The document names the address the app is served from, so the build
 * writes it from `SITE_URL` (decision 0003), beside the app.
 */

/** Where the document is published, relative to `SITE_URL`. */
export const clientIdDocumentPath = "clientid.jsonld";

/**
 * What the app says about itself, the same whether it's published in the
 * Client ID Document or sent to a registration endpoint.
 */
export interface ClientMetadata {
  readonly client_name: string;
  readonly client_uri: string;
  readonly redirect_uris: readonly string[];
  readonly post_logout_redirect_uris: readonly string[];
  readonly scope: string;
  readonly grant_types: readonly string[];
  readonly response_types: readonly string[];
  readonly token_endpoint_auth_method: "none";
  readonly application_type: "web";
}

export interface ClientIdDocument extends ClientMetadata {
  readonly "@context": readonly string[];
  readonly client_id: string;
}

/** The Client ID Document for an app served from `siteUrl`. */
export function clientIdDocument(siteUrl: URL): ClientIdDocument {
  return {
    "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
    client_id: new URL(clientIdDocumentPath, siteUrl).href,
    ...clientMetadata(siteUrl),
  };
}

/** The app's metadata, for an app served from `siteUrl`. */
export function clientMetadata(siteUrl: URL): ClientMetadata {
  const site = siteUrl.href;
  return {
    client_name: "Solid Demonstrator",
    client_uri: site,
    // The identity provider sends the person back to the start page, which
    // reads the result from the query string.
    redirect_uris: [site],
    post_logout_redirect_uris: [site],
    // No offline_access: tokens stay in memory (decision 0008), so the app
    // has nowhere to keep a refresh token.
    scope: "openid webid",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    // A browser app can't keep a secret, so it's a public client.
    token_endpoint_auth_method: "none",
    application_type: "web",
  };
}
