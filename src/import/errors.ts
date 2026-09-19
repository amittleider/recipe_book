/**
 * Why an import stopped, and what to tell the cook about it.
 *
 * Import is the one place the app talks to a server nobody here controls, so
 * every failure is expected rather than exceptional. Each reason maps to a
 * sentence that says what to do next, because "échec" on its own tells a cook
 * nothing about whether to retry, fix the link, or give up on the site.
 */
export type ImportFailure =
  | 'badUrl'
  | 'network'
  | 'blocked'
  | 'notFound'
  | 'http'
  | 'notHtml'
  | 'noRecipe'

const MESSAGES: Record<ImportFailure, string> = {
  badUrl: "Ce lien n'est pas valide.",
  network: 'Connexion impossible. Vérifiez votre réseau.',
  blocked: 'Ce site refuse la lecture automatique de ses pages.',
  notFound: 'Page introuvable.',
  http: "Le site n'a pas répondu correctement.",
  notHtml: 'Ce lien ne pointe pas vers une page de recette.',
  noRecipe: "Ce site ne publie pas sa recette dans un format lisible. Essayez un autre lien.",
}

export class ImportError extends Error {
  constructor(readonly reason: ImportFailure) {
    super(MESSAGES[reason])
    this.name = 'ImportError'
  }
}
