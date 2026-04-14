import { feature } from 'bun:bundle'
import { useEffect, useState } from 'react'
import { Box, Text } from '../../ink.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { isVoiceModeEnabled } from '../../voice/voiceModeEnabled.js'
import { AnimatedAsterisk } from './AnimatedAsterisk.js'
import { shouldShowOpus1mMergeNotice } from './Opus1mMergeNotice.js'

const MAX_SHOW_COUNT = 3

export function VoiceModeNotice() {
  return feature('VOICE_MODE') ? <VoiceModeNoticeInner /> : null
}

function VoiceModeNoticeInner() {
  const [show] = useState(
    () =>
      isVoiceModeEnabled() &&
      (getGlobalConfig().voiceNoticeSeenCount ?? 0) < MAX_SHOW_COUNT &&
      !shouldShowOpus1mMergeNotice(),
  )

  useEffect(() => {
    if (!show) {
      return
    }
    const newCount = (getGlobalConfig().voiceNoticeSeenCount ?? 0) + 1
    saveGlobalConfig(prev => {
      if ((prev.voiceNoticeSeenCount ?? 0) >= newCount) {
        return prev
      }
      return {
        ...prev,
        voiceNoticeSeenCount: newCount,
      }
    })
  }, [show])

  if (!show) {
    return null
  }

  return (
    <Box paddingLeft={2}>
      <AnimatedAsterisk />
      <Text dimColor> Voice mode is ready · hold Space to speak</Text>
    </Box>
  )
}
