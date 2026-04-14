import { useMemo } from 'react'
import { useAppState } from '../state/AppState.js'
import {
  hasVoiceAuth,
  isLocalVoiceModeEnabled,
  isVoiceGrowthBookEnabled,
} from '../voice/voiceModeEnabled.js'

/**
 * Combines user intent (settings.voiceEnabled) with auth + GB kill-switch.
 * Local voice mode (`--voice`) is an explicit per-session opt-in, so it
 * bypasses the persisted setting gate.
 * Only the auth half is memoized on authVersion — it's the expensive one
 * (cold getClaudeAIOAuthTokens memoize → sync `security` spawn, ~60ms/call,
 * ~180ms total in profile v5 when token refresh cleared the cache mid-session).
 * GB is a cheap cached-map lookup and stays outside the memo so a mid-session
 * kill-switch flip still takes effect on the next render.
 *
 * authVersion bumps on /login only. Background token refresh leaves it alone
 * (user is still authed), so the auth memo stays correct without re-eval.
 */
export function useVoiceEnabled(): boolean {
  const userIntent = useAppState(s => s.settings.voiceEnabled === true)
  const authVersion = useAppState(s => s.authVersion)
  const localMode = isLocalVoiceModeEnabled()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const authed = useMemo(hasVoiceAuth, [authVersion])
  return localMode || (userIntent && authed && isVoiceGrowthBookEnabled())
}
