import { existsSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execVoiceCommandNoThrow } from './exec.js'

const DEFAULT_WHISPER_THREADS = '8'

export function getDefaultWhisperModelPath(): string {
  return (
    process.env.FREECLAUDE_WHISPER_MODEL ||
    join(
      process.env.HOME || '/root',
      '.openclaw/models/whisper/ggml-small.bin',
    )
  )
}

export async function isFfmpegAvailable(): Promise<boolean> {
  const result = await execVoiceCommandNoThrow(
    'ffmpeg',
    ['-version'],
    { preserveOutputOnError: false },
  )
  return result.code === 0
}

function cleanWhisperOutput(output: string): string {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^\[[^\]]+\]\s*/, ''))
    .filter(line => !/^\d+$/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function isWhisperCliAvailable(): Promise<boolean> {
  const result = await execVoiceCommandNoThrow(
    'whisper-cli',
    ['--help'],
    { preserveOutputOnError: false },
  )
  return result.code === 0
}

export async function transcribePcmAudio(options: {
  audio: Buffer
  language?: string
  modelPath?: string
  threads?: number
}): Promise<string> {
  if (options.audio.length === 0) {
    return ''
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'freeclaude-voice-stt-'))
  const rawPath = join(tempDir, 'input.raw')
  const wavPath = join(tempDir, 'input.wav')
  const modelPath = options.modelPath || getDefaultWhisperModelPath()

  try {
    if (!(await isFfmpegAvailable())) {
      throw new Error('Transcription requires ffmpeg. Install with: brew install ffmpeg')
    }

    if (!(await isWhisperCliAvailable())) {
      throw new Error(
        'Transcription requires whisper-cli. Install with: brew install whisper-cpp',
      )
    }

    if (!existsSync(modelPath)) {
      throw new Error(
        `Transcription requires a Whisper model. Expected at: ${modelPath}`,
      )
    }

    await writeFile(rawPath, options.audio)

    const ffmpegResult = await execVoiceCommandNoThrow(
      'ffmpeg',
      [
        '-y',
        '-f',
        's16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-i',
        rawPath,
        wavPath,
      ],
      { preserveOutputOnError: false },
    )
    if (ffmpegResult.code !== 0) {
      throw new Error('Failed to convert recorded audio for transcription.')
    }

    const whisperResult = await execVoiceCommandNoThrow(
      'whisper-cli',
      [
        '-m',
        modelPath,
        '-l',
        options.language || 'en',
        '-t',
        String(options.threads ?? DEFAULT_WHISPER_THREADS),
        wavPath,
      ],
      { maxBuffer: 1_000_000, preserveOutputOnError: false },
    )

    if (whisperResult.code !== 0) {
      throw new Error('whisper-cli could not transcribe the recorded audio.')
    }

    return cleanWhisperOutput(whisperResult.stdout)
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => {})
  }
}
