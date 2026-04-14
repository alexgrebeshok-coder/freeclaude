/**
 * FreeClaude v3 — Voice Service
 *
 * Lightweight voice I/O using free tools:
 * - STT: Whisper (whisper-cli or whisper-cpp)
 * - TTS: Edge TTS (python edge-tts, free)
 *
 * No API keys needed — runs entirely locally.
 */

import { exec, execSync, type ExecOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  describeVoiceTranscriptionReadiness,
  isVoiceTranscriptionReady,
} from './diagnostics.js'
import { getDefaultWhisperModelPath } from './stt.js'

// ---------------------------------------------------------------------------
// STT (Speech-to-Text)
// ---------------------------------------------------------------------------

export interface STTOptions {
  language?: string   // default: 'ru'
  model?: string      // path to whisper model
  threads?: number    // default: 8
}

export interface STTResult {
  text: string
  confidence: number
  language: string
  durationMs: number
}

/**
 * Check if Whisper is available.
 */
export function isWhisperAvailable(): boolean {
  try {
    execSync('which whisper-cli 2>/dev/null', {
      timeout: 3000,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

function isFfmpegAvailableSync(): boolean {
  try {
    execSync('ffmpeg -version >/dev/null 2>&1', {
      timeout: 3000,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Transcribe audio file to text using Whisper.
 */
export async function transcribe(
  audioPath: string,
  options: STTOptions = {},
): Promise<STTResult> {
  const {
    language = 'ru',
    model = getDefaultWhisperModelPath(),
    threads = 8,
  } = options

  const startTime = Date.now()

  // Convert audio to WAV first (16kHz mono)
  const wavPath = join(tmpdir(), `fc-stt-${randomUUID().slice(0, 8)}.wav`)
  try {
    execSync(
      `ffmpeg -y -i "${audioPath}" -ar 16000 -ac 1 "${wavPath}" 2>/dev/null`,
      { timeout: 30000 },
    )
  } catch {
    // If ffmpeg fails, try using the file directly
  }

  const inputPath = existsSync(wavPath) ? wavPath : audioPath

  return new Promise((resolve) => {
    const cmd = `whisper-cli -m "${model}" -l ${language} -t ${threads} "${inputPath}" 2>/dev/null`

    exec(cmd, { timeout: 60000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      const durationMs = Date.now() - startTime
      const text = (stdout || '').trim()

      // Clean up temp file
      try { execSync(`rm -f "${wavPath}"`) } catch { /* ignore */ }

      if (error || !text) {
        resolve({
          text: '',
          confidence: 0,
          language,
          durationMs,
        })
        return
      }

      // Parse SRT-style output or plain text
      const cleanText = text
        .split('\n')
        .filter(line => line.trim() && !line.startsWith('[') && !/^\d+$/.test(line.trim()))
        .join(' ')
        .trim()

      resolve({
        text: cleanText || text,
        confidence: cleanText.length > 0 ? 0.85 : 0,
        language,
        durationMs,
      })
    })
  })
}

// ---------------------------------------------------------------------------
// TTS (Text-to-Speech)
// ---------------------------------------------------------------------------

export interface TTSOptions {
  voice?: string     // default: 'ru-RU-DmitryNeural'
  rate?: string      // default: '+0%'
  volume?: string    // default: '+0%'
  outputFormat?: string  // default: 'mp3'
}

export interface TTSResult {
  audioPath: string
  durationMs: number
  voice: string
}

/**
 * Check if Edge TTS is available.
 */
export function isEdgeTTSAvailable(): boolean {
  try {
    execSync('python3 -m edge_tts --version 2>/dev/null || pip3 show edge-tts 2>/dev/null', {
      timeout: 5000,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Synthesize text to speech using Edge TTS (free, Microsoft).
 */
export async function synthesize(
  text: string,
  options: TTSOptions = {},
): Promise<TTSResult> {
  const {
    voice = 'ru-RU-DmitryNeural',
    rate = '+0%',
    volume = '+0%',
    outputFormat = 'mp3',
  } = options

  const outputPath = join(tmpdir(), `fc-tts-${randomUUID().slice(0, 8)}.${outputFormat}`)
  const startTime = Date.now()

  return new Promise((resolve, reject) => {
    const cmd = `python3 -m edge_tts --voice "${voice}" --rate="${rate}" --volume="${volume}" --text "${text.replace(/"/g, '\\"')}" --write-media "${outputPath}" 2>/dev/null`

    exec(cmd, { timeout: 30000 }, (error) => {
      const durationMs = Date.now() - startTime

      if (error || !existsSync(outputPath)) {
        reject(new Error(`TTS failed: ${error?.message}`))
        return
      }

      resolve({
        audioPath: outputPath,
        durationMs,
        voice,
      })
    })
  })
}

/**
 * Convert audio file to OGG Opus (for Telegram).
 */
export async function toOpus(inputPath: string): Promise<string> {
  const outputPath = join(tmpdir(), `fc-ogg-${randomUUID().slice(0, 8)}.ogg`)

  return new Promise((resolve, reject) => {
    exec(
      `ffmpeg -y -i "${inputPath}" -c:a libopus -b:a 64k "${outputPath}" 2>/dev/null`,
      { timeout: 30000 },
      (error) => {
        if (error || !existsSync(outputPath)) {
          reject(new Error(`OGG conversion failed`))
          return
        }
        resolve(outputPath)
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Voice availability check
// ---------------------------------------------------------------------------

export function getVoiceStatus(): {
  stt: boolean
  tts: boolean
  ffmpeg: boolean
  whisperModel: boolean
  whisperModelPath: string
  transcriptionReady: boolean
  sttDetails: string
  ttsDetails: string
  transcriptionDetails: string
} {
  const stt = isWhisperAvailable()
  const tts = isEdgeTTSAvailable()
  const ffmpeg = isFfmpegAvailableSync()
  const whisperModelPath = getDefaultWhisperModelPath()
  const whisperModel = existsSync(whisperModelPath)
  const transcriptionReady = isVoiceTranscriptionReady({
    ffmpegAvailable: ffmpeg,
    whisperCliAvailable: stt,
    modelExists: whisperModel,
    modelPath: whisperModelPath,
  })

  return {
    stt,
    tts,
    ffmpeg,
    whisperModel,
    whisperModelPath,
    transcriptionReady,
    sttDetails: stt
      ? 'whisper-cli available'
      : 'Install: brew install whisper-cpp + download model',
    ttsDetails: tts
      ? 'edge-tts available (optional)'
      : 'Optional: pip3 install edge-tts',
    transcriptionDetails: describeVoiceTranscriptionReadiness({
      ffmpegAvailable: ffmpeg,
      whisperCliAvailable: stt,
      modelExists: whisperModel,
      modelPath: whisperModelPath,
    }),
  }
}
