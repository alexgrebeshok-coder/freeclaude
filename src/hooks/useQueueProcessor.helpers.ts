export function shouldProcessQueue({
  isQueryActive,
  hasActiveLocalJsxUI,
  queueLength,
}: {
  isQueryActive: boolean
  hasActiveLocalJsxUI: boolean
  queueLength: number
}): boolean {
  return !isQueryActive && !hasActiveLocalJsxUI && queueLength > 0
}
