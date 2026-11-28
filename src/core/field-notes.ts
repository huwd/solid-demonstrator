/**
 * What each header and form field in an exchange is for, in a sentence,
 * for the detail panel (decision 0018). Only fields the demonstrator's
 * exchanges carry, or a Solid server commonly answers with, have a note.
 */

const headerNotes: Readonly<Record<string, string>> = {
  accept: "The formats the app will take, best first.",
  "access-control-allow-origin":
    "Lets this page read the answer. Without it the browser hides the answer from the app.",
  "access-control-expose-headers": "The headers the browser may show the app.",
  authorization:
    "The access token, which the record leaves out. The DPoP scheme says a proof must come with it.",
  "content-type": "The format of the body.",
  dpop: "A proof signed with this tab's key, for this one request. It's shown in full, since it can't be used again.",
  "dpop-nonce": "A value the server wants in the next proof, so an old proof can't be replayed.",
  etag: "The version of what came back. The app sends it with If-Match when it changes the resource.",
  "if-match": "Only make the change if the resource is still this version.",
  "if-none-match": "With *, only create the resource if nothing is there yet.",
  link: "Related resources, such as the access rules (acl) or the storage description.",
  location: "Where to go next, or where a new resource was made.",
  upgrade: "Asks to turn the connection into a WebSocket.",
  "wac-allow": "What this person, and everyone, may do with the resource.",
  "www-authenticate": "How to authenticate, sent with a 401.",
};

const fieldNotes: Readonly<Record<string, string>> = {
  client_id:
    "Which app is asking: the address of its Client ID Document, or an identifier from registration.",
  code: "The one-time code from the sign-in, shortened. It's secret until it's spent.",
  code_challenge:
    "A hash of a secret only this app holds, which the provider checks when the code is spent (PKCE).",
  code_challenge_method: "How the challenge was hashed.",
  code_verifier:
    "The secret behind the challenge, shortened. It proves this app started the login (PKCE).",
  grant_type: "What the app is trading for tokens.",
  redirect_uri: "Where the provider sends the person back to.",
  response_type: "Asks for a one-time code.",
  scope: "What the app asks for. In Solid, openid webid grants no access to data by itself.",
  state: "A value checked on return, so another site can't start this login. Shortened.",
  nonce: "A value the ID token must repeat, so an old one can't be replayed. Shortened.",
};

/** The note for a header, by its name in any case, or null. */
export function headerNote(name: string): string | null {
  return headerNotes[name.toLowerCase()] ?? null;
}

/** The note for a form or query field, or null. */
export function fieldNote(name: string): string | null {
  return fieldNotes[name] ?? null;
}
