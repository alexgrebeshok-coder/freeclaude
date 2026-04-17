import { transcribePcmAudio } from './stt.js'
import type {
  FinalizeSource,
  VoiceStreamCallbacks,
  VoiceStreamConnection,
} from './types.js'

const LOCAL_VOICE_ENV = 'FREECLAUDE_LOCAL_VOICE'
export const MAX_LOCAL_VOICE_BUFFER_BYTES = 10 * 1024 * 1024
export const LOCAL_VOICE_TRANSCRIBE_TIMEOUT_MS = 30_000

function formatBufferLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`
  }
  return `${bytes} bytes`
}

export function isLocalVoiceModeRequested(): boolean {
  return process.env[LOCAL_VOICE_ENV] === '1'
}

export function setLocalVoiceModeEnabled(enabled: boolean): void {
  process.env[LOCAL_VOICE_ENV] = enabled ? '1' : '0'
}

export async function connectLocalVoiceMode(
  callbacks: VoiceStreamCallbacks,
  options?: {
    language?: string
    maxBufferBytes?: number
    maxTranscribeMs?: number
    transcribeAudio?: typeof transcribePcmAudio
  },
): Promise<VoiceStreamConnection | null> {
  const audioChunks: Buffer[] = []
  const maxBufferBytes = options?.maxBufferBytes ?? MAX_LOCAL_VOICE_BUFFER_BYTES
  const maxTranscribeMs =
    options?.maxTranscribeMs ?? LOCAL_VOICE_TRANSCRIBE_TIMEOUT_MS
  const transcribeAudio = options?.transcribeAudio ?? transcribePcmAudio
  let bufferedBytes = 0
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
      const nextBufferedBytes = bufferedBytes + audioChunk.length
      if (nextBufferedBytes > maxBufferBytes) {
        isClosed = true
        finalized = true
        callbacks.onError(
          `Voice recording exceeded the ${formatBufferLimit(maxBufferBytes)} local buffer limit. Try a shorter utterance.`,
          { fatal: true },
        )
        reportClose()
        return
      }
      bufferedBytes = nextBufferedBytes
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
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        try {
          const timeoutPromise = new Promise<string>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(
                new Error(
                  `Local voice transcription timed out after ${Math.floor(maxTranscribeMs / 1000)}s.`,
                ),
              )
            }, maxTranscribeMs)
          })

          const text = await Promise.race([
            transcribeAudio({
              audio: Buffer.concat(audioChunks),
              language: options?.language,
            }),
            timeoutPromise,
          ])

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
          if (timeoutHandle) {
            clearTimeout(timeoutHandle)
          }
          audioChunks.length = 0
          bufferedBytes = 0
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
