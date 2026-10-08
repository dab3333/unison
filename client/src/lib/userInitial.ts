/** First visible character of a name, uppercased, for avatar circles. Safe for emoji; '?' when there is none. */
export function userInitial(name: string | undefined): string {
  const first = Array.from((name ?? '').trim())[0]
  return first ? first.toUpperCase() : '?'
}
