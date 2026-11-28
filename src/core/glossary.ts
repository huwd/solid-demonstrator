/**
 * The words Solid uses, each in a sentence of everyday language (issue 39).
 * The start page lists them, and the story of the introduction keeps to
 * the plain words, explaining the others where they first appear.
 */

export interface GlossaryEntry {
  readonly term: string;
  readonly meaning: string;
}

export const glossary: readonly GlossaryEntry[] = [
  {
    term: "Pod",
    meaning:
      "Your own online storage, in a place you choose. Apps ask to use parts of it, and you decide which.",
  },
  {
    term: "WebID",
    meaning:
      "A web address that stands for you. Opening it gives your profile, which says how you log in and where your Pod is.",
  },
  {
    term: "Identity provider",
    meaning:
      "The service you log in with. Your profile names it, so Pods know to trust it to say who you are.",
  },
  {
    term: "Access token",
    meaning:
      "A pass the identity provider gives an app when you log in, saying who you are. The app shows it to your Pod with every request.",
  },
  {
    term: "DPoP proof",
    meaning:
      "A stamp that only the browser tab you logged in with can make. A pass works only with a fresh stamp, so a stolen pass is useless.",
  },
  {
    term: "Access rules",
    meaning:
      "The rules your Pod keeps on who may open each folder and file, and through which apps. Logging in doesn't change them.",
  },
  {
    term: "Notification service",
    meaning: "The part of a Pod that tells apps when something changes, whoever changed it.",
  },
];
