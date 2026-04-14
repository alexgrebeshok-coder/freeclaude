import { normalizeLanguageForSTT } from '../../hooks/useVoice.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { isVoiceModeEnabled } from '../../voice/voiceModeEnabled.js'

const LANG_HINT_MAX_SHOWS = 2

export const call: LocalCommandCall = async () => {
  if (!isVoiceModeEnabled()) {
    return {
      type: 'text' as const,
      value: 'Voice mode is not available.',
    }
  }

  const { checkRecordingAvailability } = await import('../../services/voice.js')
  const { isWhisperCliAvailable } = await import('../../services/voice/stt.js')

  const recording = await checkRecordingAvailability()
  if (!recording.available) {
    return {
      type: 'text' as const,
      value:
        recording.reason ?? 'Voice mode is not available in this environment.',
    }
  }

  const key = getShortcutDisplay('voice:pushToTalk', 'Chat', 'Space')
  const stt = normalizeLanguageForSTT(getInitialSettings().language)
  const cfg = getGlobalConfig()
  // Reset the hint counter whenever the resolved STT language changes
  // (including first-ever check, where lastLanguage is undefined).
  const langChanged = cfg.voiceLangHintLastLanguage !== stt.code
  const priorCount = langChanged ? 0 : (cfg.voiceLangHintShownCount ?? 0)
  const showHint = !stt.fellBackFrom && priorCount < LANG_HINT_MAX_SHOWS
  let langNote = ''
  if (stt.fellBackFrom) {
    langNote = ` Note: "${stt.fellBackFrom}" is not a supported dictation language; using English. Change it via /config.`
  } else if (showHint) {
    langNote = ` Dictation language: ${stt.code} (/config to change).`
  }
  if (langChanged || showHint) {
    saveGlobalConfig(prev => ({
      ...prev,
      voiceLangHintShownCount: priorCount + (showHint ? 1 : 0),
      voiceLangHintLastLanguage: stt.code,
    }))
  }
  if (!(await isWhisperCliAvailable())) {
    return {
      type: 'text' as const,
      value: `Voice mode is always on. Hold ${key} to record. Transcription requires whisper-cli. Install with: brew install whisper-cpp`,
    }
  }
  return {
    type: 'text' as const,
    value: `Voice mode is always on. Hold ${key} to record.${langNote}`,
  }
}
