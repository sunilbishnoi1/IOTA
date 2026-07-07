/**
 * Format duration in milliseconds to human-readable string.
 * Examples: "12s", "1m 30s", "2h 15m"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0s'
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

/**
 * Parse the first bold line `**Title**` as a reasoning header.
 * Returns the title (or null if not found) and the body text.
 */
export function getReasoningSummary(text: string): { title: string | null; body: string } {
  const match = text.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/)
  if (!match) return { title: null, body: text }
  return { title: match[1].trim(), body: text.slice(match[0].length).trimEnd() }
}
