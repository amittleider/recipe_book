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
  // Reading a recipe off a photograph rather than a page.
  | 'unreadable'
  | 'noText'
  | 'noRecipeInPhoto'

const MESSAGES: Record<ImportFailure, string> = {
  badUrl: "Ce lien n'est pas valide.",
  network: 'Connexion impossible. Vérifiez votre réseau.',
  blocked: 'Ce site refuse la lecture automatique de ses pages.',
  notFound: 'Page introuvable.',
  http: "Le site n'a pas répondu correctement.",
  notHtml: 'Ce lien ne pointe pas vers une page de recette.',
  noRecipe: "Ce site ne publie pas sa recette dans un format lisible. Essayez un autre lien.",
  unreadable: "Cette image n'a pas pu être ouverte.",
  noText: 'Aucun texte lisible sur cette photo. Rapprochez-vous et évitez les ombres.',
  noRecipeInPhoto:
    "Du texte a été lu, mais pas une recette. Cadrez les ingrédients et la préparation dans la photo.",
}

export class ImportError extends Error {
  // Declared and assigned rather than written as a constructor parameter
  // property: the test runner strips types without transforming them, and a
  // parameter property is the one piece of TypeScript that cannot survive that.
  // The two forms are otherwise identical.
  readonly reason: ImportFailure

  constructor(reason: ImportFailure) {
    super(MESSAGES[reason])
    this.reason = reason
    this.name = 'ImportError'
  }
}
