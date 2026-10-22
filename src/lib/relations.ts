export function relationField(
  value: unknown,
  key: string
): string | null {
  const item = Array.isArray(value) ? value[0] : value
  if (!item || typeof item !== 'object') {
    return null
  }
  const field = (item as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : null
}
