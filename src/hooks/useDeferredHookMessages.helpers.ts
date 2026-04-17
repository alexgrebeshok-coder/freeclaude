export function prependDeferredHookMessages<T>(
  existingMessages: readonly T[],
  deferredMessages: readonly T[],
): T[] {
  return deferredMessages.length > 0
    ? [...deferredMessages, ...existingMessages]
    : [...existingMessages]
}

export function shouldFlushDeferredHookMessages({
  resolved,
  hasPendingPromise,
}: {
  resolved: boolean
  hasPendingPromise: boolean
}): boolean {
  return !resolved && hasPendingPromise
}
