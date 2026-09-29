import type { Source } from '@unison/shared'

export interface PickedFile {
  file: File
  sourceKey: string
}

/** Order-independent identity of a source, so a host-tagged key matches the server's echo. */
export function sourceKeyOf(source: Source): string {
  return JSON.stringify(Object.entries(source).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

export function pickedFor(file: File, source: Source): PickedFile {
  return { file, sourceKey: sourceKeyOf(source) }
}

/** A picked file is only valid for the source it was picked for. */
export function fileForSource(picked: PickedFile | null, source: Source | null): File | null {
  return picked && source && picked.sourceKey === sourceKeyOf(source) ? picked.file : null
}
