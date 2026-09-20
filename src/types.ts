export type DriveFolder = { id: string; name: string }

/**
 * One photo or video sitting next to `recipe.md` in a recipe's Drive folder.
 *
 * The identity is the **file name**, not the Drive file id: that is what the
 * markdown references, what the local cache is keyed by, and what survives a
 * file being replaced from a laptop. The id is how the app fetches the bytes.
 *
 * The validator rides along here rather than on `CachedRecipe` because media is
 * a list — splitting freshness into a parallel array would buy nothing.
 */
export type RecipeMedia = {
  name: string
  /** Empty while the file exists only on this device and has not been uploaded. */
  fileId: string
  mimeType: string
  /** Drive validator for the cached bytes; empty means "not trusted". */
  validator: string
  size: number
  /**
   * The validator of the copy currently in the local cache, so a file replaced
   * from another device is noticed and fetched again — the same scheme the
   * recipe bodies use. Absent means nothing is cached yet.
   */
  cached?: string
  /** Captured here and still waiting to reach Drive. */
  pending?: true
}

export type RecipeSummary = {
  folderId: string
  fileId: string | null
  slug: string
  title: string
  time: string
  /**
   * Undefined in a manifest written before tags existed, which is not the same
   * as an untagged recipe. The next sync tells the two apart and fills this in
   * from the body already on disk, without asking Drive for anything.
   */
  tags?: string[]
  /**
   * Ordered: the first entry is the cover. Undefined in a manifest written
   * before media existed, which the next sync fills in — see `tags` above.
   */
  media?: RecipeMedia[]
}
