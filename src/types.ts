export type DriveFolder = {
  id: string
  name: string
}

export type RecipeSummary = {
  folderId: string
  fileId: string | null
  slug: string
  title: string
  time: string
}
