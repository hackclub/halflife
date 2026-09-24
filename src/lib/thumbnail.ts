import { imageSources } from "@/components/platform/Markdown"

interface EntryImages {
  createdAt: Date
  content: string | null
}

/**
 * The picture a project is shown by.
 *
 * One the maker chose wins. Until then it is the newest picture in their
 * journal — the last one in the latest entry that has any — so a project
 * looks like where the work has got to rather than like its week's clip art,
 * and moves on by itself as the work does. Null when there is neither, and
 * the caller falls back to the week's scene.
 */
export function projectThumbnail(chosenUrl: string | null, entries: EntryImages[]): string | null {
  if (chosenUrl) return chosenUrl
  return latestJournalImage(entries)
}

export function latestJournalImage(entries: EntryImages[]): string | null {
  const newest = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  for (const entry of newest) {
    const found = imageSources(entry.content ?? "")
    const last = found[found.length - 1]
    if (last) return last
  }
  return null
}
