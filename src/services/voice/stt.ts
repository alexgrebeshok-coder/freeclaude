import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'

const DEFAULT_WHISPER_THREADS = '8'

function getDefaultWhisperModelPath(): string {
  return (
    process.env.FREECLAUDE_WHISPER_MODEL ||
    join(
      process.env.HOME || '/root',
      '.openclaw/models/whisper/ggml-small.bin',
    )
  )
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
  const result = await execFileNoThrow(
    'whisper-cli',
    ['--help'],
    { preserveOutputOnError: false, useCwd: false },
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

  try {
    await writeFile(rawPath, options.audio)

    const ffmpegResult = await execFileNoThrow(
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
      { preserveOutputOnError: false, useCwd: false },
    )
    if (ffmpegResult.code !== 0) {
      return ''
    }

    const whisperResult = await execFileNoThrow(
      'whisper-cli',
      [
        '-m',
        options.modelPath || getDefaultWhisperModelPath(),
        '-l',
        options.language || 'en',
        '-t',
        String(options.threads ?? DEFAULT_WHISPER_THREADS),
        wavPath,
      ],
      { maxBuffer: 1_000_000, preserveOutputOnError: false, useCwd: false },
    )

    if (whisperResult.code !== 0) {
      return ''
    }

    return cleanWhisperOutput(whisperResult.stdout)
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => {})
  }
}
