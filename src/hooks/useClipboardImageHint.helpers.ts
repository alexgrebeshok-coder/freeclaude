export function shouldCheckClipboardImageHint({
  enabled,
  isFocused,
  wasFocused,
}: {
  enabled: boolean
  isFocused: boolean
  wasFocused: boolean
}): boolean {
  return enabled && isFocused && !wasFocused
}

export function isClipboardHintOnCooldown(
  lastHintTime: number,
  now: number,
  cooldownMs: number,
): boolean {
  return now - lastHintTime < cooldownMs
}
