import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { getRoutine, listRoutines } from './store.js'
import { RoutineRunBlockedError, startRoutineRun } from './runner.js'

export const ROUTINE_API_DEFAULT_HOST = '127.0.0.1'
export const ROUTINE_API_DEFAULT_PORT = 8787

export interface RoutineApiServerStatus {
  running: boolean
  host: string | null
  port: number | null
  url: string | null
}

export interface RoutineApiResponse {
  status: number
  body: string
  headers?: Record<string, string>
}

export interface HandleRoutineApiRequestInput {
  method: string
  pathname: string
  headers?: Record<string, string | string[] | undefined>
  bodyText?: string
  startRun?: typeof startRoutineRun
}

let activeServer: Server | null = null
let activeStatus: RoutineApiServerStatus = {
  running: false,
  host: null,
  port: null,
  url: null,
}

function json(
  status: number,
  payload: Record<string, unknown>,
): RoutineApiResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  }
}

function getBearerToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const authHeader = headers.authorization
  const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader
  if (authValue?.startsWith('Bearer ')) {
    return authValue.slice('Bearer '.length).trim()
  }

  const routineHeader = headers['x-routine-token']
  const routineValue = Array.isArray(routineHeader)
    ? routineHeader[0]
    : routineHeader
  return routineValue?.trim() || null
}

function parseRequestPayload(bodyText: string | undefined): {
  context?: string
} {
  if (!bodyText?.trim()) {
    return {}
  }

  const parsed = JSON.parse(bodyText) as Record<string, unknown>
  return typeof parsed.context === 'string'
    ? { context: parsed.context }
    : {}
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function verifyGitHubSignature(
  bodyText: string,
  secret: string,
  signatureHeader: string | string[] | undefined,
): boolean {
  const signature = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader
  if (!signature?.startsWith('sha256=')) {
    return false
  }

  const expected =
    'sha256=' + createHmac('sha256', secret).update(bodyText).digest('hex')
  return safeEquals(signature, expected)
}

function buildGitHubContext(
  event: string,
  payload: Record<string, unknown>,
): string {
  const action = typeof payload.action === 'string' ? payload.action : 'unknown'
  const repository =
    typeof payload.repository === 'object' &&
    payload.repository &&
    typeof (payload.repository as { full_name?: unknown }).full_name === 'string'
      ? (payload.repository as { full_name: string }).full_name
      : 'unknown'

  return [
    `GitHub event: ${event}`,
    `Action: ${action}`,
    `Repository: ${repository}`,
    '',
    'Payload:',
    JSON.stringify(payload, null, 2),
  ].join('\n')
}

export function getRoutineApiServerStatus(): RoutineApiServerStatus {
  return { ...activeStatus }
}

export async function handleRoutineApiRequest(
  input: HandleRoutineApiRequestInput,
): Promise<RoutineApiResponse> {
  const headers = input.headers ?? {}
  const method = input.method.toUpperCase()
  const startRun = input.startRun ?? startRoutineRun

  if (method === 'GET' && input.pathname === '/health') {
    const routines = listRoutines()
    return json(200, {
      ok: true,
      running: activeStatus.running,
      apiEnabledRoutines: routines.filter(routine => routine.triggers.api.enabled)
        .length,
      totalRoutines: routines.length,
    })
  }

  const match = input.pathname.match(/^\/routines\/([^/]+)\/run$/)
  if (method === 'POST' && match) {
    const idOrName = decodeURIComponent(match[1]!)
    let routine
    try {
      routine = getRoutine(idOrName)
    } catch {
      return json(404, { ok: false, error: `Routine "${idOrName}" not found` })
    }

    if (!routine.triggers.api.enabled || !routine.triggers.api.token) {
      return json(403, {
        ok: false,
        error: `Routine "${routine.name}" does not have API trigger enabled`,
      })
    }

    const token = getBearerToken(headers)
    if (!token) {
      return json(401, { ok: false, error: 'Missing bearer token' })
    }
    if (token !== routine.triggers.api.token) {
      return json(403, { ok: false, error: 'Invalid routine token' })
    }

    let payload: { context?: string }
    try {
      payload = parseRequestPayload(input.bodyText)
    } catch {
      return json(400, { ok: false, error: 'Invalid JSON payload' })
    }

    try {
      const started = startRun({
        routineIdOrName: routine.id,
        trigger: 'api',
        extraContext: payload.context,
      })

      return json(202, {
        ok: true,
        routineId: started.routine.id,
        routineName: started.routine.name,
        runId: started.run.id,
        taskId: started.taskId,
        taskShortId: started.taskShortId,
      })
    } catch (error) {
      return json(
        error instanceof RoutineRunBlockedError ? 409 : 500,
        { ok: false, error: toErrorMessage(error) },
      )
    }
  }

  const githubMatch = input.pathname.match(/^\/github\/([^/]+)$/)
  if (method === 'POST' && githubMatch) {
    const idOrName = decodeURIComponent(githubMatch[1]!)
    let routine
    try {
      routine = getRoutine(idOrName)
    } catch {
      return json(404, { ok: false, error: `Routine "${idOrName}" not found` })
    }

    if (!routine.triggers.github.event || !routine.triggers.github.secret) {
      return json(403, {
        ok: false,
        error: `Routine "${routine.name}" does not have GitHub webhook enabled`,
      })
    }

    const eventHeader = headers['x-github-event']
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader
    if (event !== routine.triggers.github.event) {
      return json(403, {
        ok: false,
        error: `Unexpected GitHub event "${event ?? 'unknown'}"`,
      })
    }

    const bodyText = input.bodyText ?? ''
    if (
      !verifyGitHubSignature(
        bodyText,
        routine.triggers.github.secret,
        headers['x-hub-signature-256'],
      )
    ) {
      return json(401, { ok: false, error: 'Invalid GitHub webhook signature' })
    }

    let payload: Record<string, unknown>
    try {
      payload = bodyText.trim()
        ? (JSON.parse(bodyText) as Record<string, unknown>)
        : {}
    } catch {
      return json(400, { ok: false, error: 'Invalid JSON payload' })
    }

    const repoFullName =
      typeof payload.repository === 'object' &&
      payload.repository &&
      typeof (payload.repository as { full_name?: unknown }).full_name === 'string'
        ? (payload.repository as { full_name: string }).full_name
        : null

    if (
      routine.repos.length > 0 &&
      (!repoFullName || !routine.repos.includes(repoFullName))
    ) {
      return json(403, {
        ok: false,
        error: `Repository "${repoFullName ?? 'unknown'}" is not allowed for this routine`,
      })
    }

    try {
      const started = startRun({
        routineIdOrName: routine.id,
        trigger: 'github',
        extraContext: buildGitHubContext(event, payload),
      })

      return json(202, {
        ok: true,
        routineId: started.routine.id,
        routineName: started.routine.name,
        runId: started.run.id,
        taskId: started.taskId,
        taskShortId: started.taskShortId,
      })
    } catch (error) {
      return json(
        error instanceof RoutineRunBlockedError ? 409 : 500,
        { ok: false, error: toErrorMessage(error) },
      )
    }
  }

  return json(404, {
    ok: false,
    error: 'Unknown route',
    routes: ['GET /health', 'POST /routines/:id/run', 'POST /github/:id'],
  })
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

async function writeResponse(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const response = await handleRoutineApiRequest({
    method: req.method || 'GET',
    pathname: url.pathname,
    headers: req.headers,
    bodyText: await readBody(req),
  })

  res.writeHead(response.status, response.headers)
  res.end(response.body)
}

export async function startRoutineApiServer(options?: {
  host?: string
  port?: number
}): Promise<RoutineApiServerStatus> {
  if (activeServer) {
    return getRoutineApiServerStatus()
  }

  const host = options?.host ?? ROUTINE_API_DEFAULT_HOST
  const port = options?.port ?? ROUTINE_API_DEFAULT_PORT

  const server = createServer((req, res) => {
    void writeResponse(req, res).catch(error => {
      res.writeHead(500, {
        'content-type': 'application/json; charset=utf-8',
      })
      res.end(
        JSON.stringify({
          ok: false,
          error: toErrorMessage(error),
        }),
      )
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const actualPort =
    address && typeof address === 'object' ? address.port : port

  activeServer = server
  activeStatus = {
    running: true,
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
  }

  server.on('close', () => {
    activeServer = null
    activeStatus = {
      running: false,
      host: null,
      port: null,
      url: null,
    }
  })

  return getRoutineApiServerStatus()
}

export async function stopRoutineApiServer(): Promise<boolean> {
  if (!activeServer) {
    return false
  }

  await new Promise<void>((resolve, reject) => {
    activeServer!.close(error => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

  return true
}
