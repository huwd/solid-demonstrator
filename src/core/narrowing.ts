/**
 * Example access rules that narrow the app to the scratch folder, for the
 * person to apply in their Pod (decision 0017). The app never applies
 * them: editing access rules can lock an owner out of their own Pod.
 *
 * They only narrow the app if no other rule lets the person's WebID in
 * through any app, so the explanation says so.
 */

export interface NarrowingSubject {
  readonly webId: string;
  /** The token's client_id: the app's Client ID Document, or an identifier from registration. */
  readonly clientId: string | null;
  /** The app's origin, as browsers send it in the Origin header. */
  readonly origin: string;
  readonly folder: URL;
}

/** An ACP policy for the folder's access control resource; null if the app has no stable client identifier. */
export function acpExample(subject: NarrowingSubject): string | null {
  if (!hasStableClientId(subject.clientId)) {
    return null;
  }
  return `@prefix acp: <http://www.w3.org/ns/solid/acp#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .

# In the access control resource of ${subject.folder.href}
<#demonstratorAccess> acp:apply <#demonstratorPolicy> .
<#demonstratorPolicy>
    acp:allow acl:Read, acl:Write ;
    acp:allOf <#thisPersonThroughThisApp> .
<#thisPersonThroughThisApp>
    acp:agent <${subject.webId}> ;
    acp:client <${subject.clientId}> .

# Link the access control to the folder, and to what it holds:
# <the ACR's own subject> acp:accessControl <#demonstratorAccess> ;
#     acp:memberAccessControl <#demonstratorAccess> .
`;
}

/** A WAC authorisation for the folder's ACL document. */
export function wacExample(subject: NarrowingSubject): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

# In the ACL document of ${subject.folder.href}
<#demonstrator> a acl:Authorization ;
    acl:agent <${subject.webId}> ;
    acl:origin <${subject.origin}> ;
    acl:accessTo <${subject.folder.href}> ;
    acl:default <${subject.folder.href}> ;
    acl:mode acl:Read, acl:Write .
`;
}

/** Whether ACP can name the app: only a Client ID Document's URL stays the same between logins. */
export function hasStableClientId(clientId: string | null): clientId is string {
  return clientId !== null && /^https:\/\//.test(clientId);
}
