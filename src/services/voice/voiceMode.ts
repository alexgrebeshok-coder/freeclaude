import { transcribePcmAudio } from './stt.js'
import type {
  FinalizeSource,
  VoiceStreamCallbacks,
  VoiceStreamConnection,
} from './types.js'

const LOCAL_VOICE_ENV = 'FREECLAUDE_LOCAL_VOICE'

export function isLocalVoiceModeRequested(): boolean {
  return process.env[LOCAL_VOICE_ENV] === '1'
}

export function setLocalVoiceModeEnabled(enabled: boolean): void {
  process.env[LOCAL_VOICE_ENV] = enabled ? '1' : '0'
}

export async function connectLocalVoiceMode(
  callbacks: VoiceStreamCallbacks,
  options?: { language?: string },
): Promise<VoiceStreamConnection | null> {
  const audioChunks: Buffer[] = []
  let isClosed = false
  let finalized = false
  let finalizePromise: Promise<FinalizeSource> | null = null
  let closeReported = false

  function reportClose(): void {
    if (closeReported) {
      return
    }
    closeReported = true
    callbacks.onClose()
  }

  const connection: VoiceStreamConnection = {
    send(audioChunk: Buffer): void {
      if (isClosed || finalized) {
        return
      }
      audioChunks.push(Buffer.from(audioChunk))
    },
    finalize(): Promise<FinalizeSource> {
      if (finalizePromise) {
        return finalizePromise
      }
      if (isClosed) {
        return Promise.resolve('ws_already_closed')
      }

      finalized = true
      finalizePromise = (async () => {
        try {
          const text = await transcribePcmAudio({
            audio: Buffer.concat(audioChunks),
            language: options?.language,
          })

          if (text) {
            callbacks.onTranscript(text, true)
            return 'post_closestream_endpoint'
          }

          return 'no_data_timeout'
        } catch (error) {
          callbacks.onError(
            error instanceof Error ? error.message : 'Local voice transcription failed',
          )
          return 'safety_timeout'
        } finally {
          isClosed = true
          reportClose()
        }
      })()

      return finalizePromise
    },
    close(): void {
      isClosed = true
      reportClose()
    },
    isConnected(): boolean {
      return !isClosed
    },
  }

  queueMicrotask(() => {
    if (isClosed) {
      return
    }
    callbacks.onReady(connection)
  })

  return connection
}
