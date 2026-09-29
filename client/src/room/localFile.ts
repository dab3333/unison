import { validateSource, type Source } from '@unison/shared'

export interface PickedFile {
  file: File
  sourceKey: string
}

/**
 * Identity of a source, robust to the server's normalization: normalize the same way the server
 * does, then key only on the fields that matter, in a fixed order.
 */
export function sourceKeyOf(source: Source): string {
  const n = validateSource(source) ?? source
  return JSON.stringify([n.type, n.id ?? null, n.url ?? null, n.name ?? null, n.size ?? null, n.duration ?? null])
}

export function pickedFor(file: File, source: Source): PickedFile {
  return { file, sourceKey: sourceKeyOf(source) }
}

/** A picked file is only valid for the source it was picked for. */
export function fileForSource(picked: PickedFile | null, source: Source | null): File | null {
  return picked && source && picked.sourceKey === sourceKeyOf(source) ? picked.file : null
}
