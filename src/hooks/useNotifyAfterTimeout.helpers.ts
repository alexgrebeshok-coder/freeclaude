export function getTimeSinceLastInteraction(
  lastInteractionTime: number,
  now: number = Date.now(),
): number {
  return now - lastInteractionTime
}

export function hasRecentInteraction(
  lastInteractionTime: number,
  threshold: number,
  now: number = Date.now(),
): boolean {
  return getTimeSinceLastInteraction(lastInteractionTime, now) < threshold
}

export function shouldNotifyAfterTimeout({
  nodeEnv,
  lastInteractionTime,
  threshold,
  now = Date.now(),
}: {
  nodeEnv?: string
  lastInteractionTime: number
  threshold: number
  now?: number
}): boolean {
  return (
    nodeEnv !== 'test' &&
    !hasRecentInteraction(lastInteractionTime, threshold, now)
  )
}
