import { access } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'

export async function isEdgeTtsAvailable(): Promise<boolean> {
  const result = await execFileNoThrow(
    'python3',
    ['-m', 'edge_tts', '--help'],
    { preserveOutputOnError: false, useCwd: false },
  )
  return result.code === 0
}

export async function synthesizeSpeech(options: {
  text: string
  voice?: string
  rate?: string
  volume?: string
  outputPath?: string
}): Promise<string> {
  const outputPath =
    options.outputPath ||
    join(tmpdir(), `freeclaude-tts-${randomUUID().slice(0, 8)}.mp3`)

  const result = await execFileNoThrow(
    'python3',
    [
      '-m',
      'edge_tts',
      '--voice',
      options.voice || 'en-US-AriaNeural',
      `--rate=${options.rate || '+0%'}`,
      `--volume=${options.volume || '+0%'}`,
      '--text',
      options.text,
      '--write-media',
      outputPath,
    ],
    { maxBuffer: 1_000_000, preserveOutputOnError: false, useCwd: false },
  )

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'edge-tts failed')
  }

  await access(outputPath)
  return outputPath
}
