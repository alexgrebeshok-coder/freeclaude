import { type ExecaError, execa } from 'execa'

type VoiceExecOptions = {
  timeout?: number
  maxBuffer?: number
  env?: NodeJS.ProcessEnv
  input?: string
  preserveOutputOnError?: boolean
}

type VoiceExecResult = {
  stdout: string
  stderr: string
  code: number
  error?: string
}

type ErrorLike = {
  shortMessage?: string
  signal?: string
}

function getErrorMessage(error: ErrorLike, code: number): string {
  if (typeof error.shortMessage === 'string' && error.shortMessage) {
    return error.shortMessage
  }
  if (typeof error.signal === 'string' && error.signal) {
    return error.signal
  }
  return String(code)
}

export function execVoiceCommandNoThrow(
  file: string,
  args: string[],
  options: VoiceExecOptions = {},
): Promise<VoiceExecResult> {
  return new Promise(resolve => {
    execa(file, args, {
      reject: false,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      env: options.env,
      input: options.input,
    })
      .then(result => {
        if (result.failed) {
          const code = result.exitCode ?? 1
          if (options.preserveOutputOnError === false) {
            resolve({ stdout: '', stderr: '', code })
            return
          }
          resolve({
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            code,
            error: getErrorMessage(result, code),
          })
          return
        }

        resolve({
          stdout: result.stdout,
          stderr: result.stderr,
          code: 0,
        })
      })
      .catch((error: ExecaError) => {
        resolve({
          stdout: '',
          stderr: '',
          code: 1,
          error: getErrorMessage(error, 1),
        })
      })
  })
}
