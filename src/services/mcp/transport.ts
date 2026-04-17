import { feature } from 'bun:bundle'
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  createFetchWithInit,
  type FetchLike,
  type Transport as SDKTransport,
} from '@modelcontextprotocol/sdk/shared/transport.js'
import mapValues from 'lodash-es/mapValues.js'
import { getSessionId } from '../../bootstrap/state.js'
import { getOauthConfig } from '../../constants/oauth.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
} from '../../utils/auth.js'
import { isClaudeInChromeMCPServer } from '../../utils/claudeInChrome/common.js'
import { logMCPDebug } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getMCPUserAgent } from '../../utils/http.js'
import { WebSocketTransport } from '../../utils/mcpWebSocketTransport.js'
import { getWebSocketTLSOptions } from '../../utils/mtls.js'
import {
  getProxyFetchOptions,
  getWebSocketProxyAgent,
  getWebSocketProxyUrl,
} from '../../utils/proxy.js'
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js'
import { subprocessEnv } from '../../utils/subprocessEnv.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { ClaudeAuthProvider, wrapFetchWithStepUpDetection } from './auth.js'
import { getMcpServerHeaders } from './headersHelper.js'
import type { ScopedMcpServerConfig } from './types.js'

const isComputerUseMCPServer = feature('CHICAGO_MCP')
  ? (
      require('../../utils/computerUse/common.js') as typeof import('../../utils/computerUse/common.js')
    ).isComputerUseMCPServer
  : undefined

type InProcessMcpServer = {
  connect(t: SDKTransport): Promise<void>
  close(): Promise<void>
}

type CreatedMcpTransport = {
  transport: SDKTransport
  inProcessServer?: InProcessMcpServer
}

type WsClientLike = {
  readonly readyState: number
  close(): void
  send(data: string): void
}

const MCP_REQUEST_TIMEOUT_MS = 60000
const MCP_STREAMABLE_HTTP_ACCEPT = 'application/json, text/event-stream'

async function createNodeWsClient(
  url: string,
  options: Record<string, unknown>,
): Promise<WsClientLike> {
  const wsModule = await import('ws')
  const WS = wsModule.default as unknown as new (
    url: string,
    protocols: string[],
    options: Record<string, unknown>,
  ) => WsClientLike
  return new WS(url, ['mcp'], options)
}

function wrapFetchWithTimeout(baseFetch: FetchLike): FetchLike {
  return async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()

    if (method === 'GET') {
      return baseFetch(url, init)
    }

    const headers = new Headers(init?.headers)
    if (!headers.has('accept')) {
      headers.set('accept', MCP_STREAMABLE_HTTP_ACCEPT)
    }

    const controller = new AbortController()
    const timer = setTimeout(
      c =>
        c.abort(new DOMException('The operation timed out.', 'TimeoutError')),
      MCP_REQUEST_TIMEOUT_MS,
      controller,
    )
    timer.unref?.()

    const parentSignal = init?.signal
    const abort = () => controller.abort(parentSignal?.reason)
    parentSignal?.addEventListener('abort', abort)
    if (parentSignal?.aborted) {
      controller.abort(parentSignal.reason)
    }

    const cleanup = () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abort)
    }

    try {
      const response = await baseFetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      })
      cleanup()
      return response
    } catch (error) {
      cleanup()
      throw error
    }
  }
}

function createClaudeAiProxyFetch(innerFetch: FetchLike): FetchLike {
  return async (url, init) => {
    const doRequest = async () => {
      await checkAndRefreshOAuthTokenIfNeeded()
      const currentTokens = getClaudeAIOAuthTokens()
      if (!currentTokens) {
        throw new Error('No claude.ai OAuth token available')
      }
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${currentTokens.accessToken}`)
      const response = await innerFetch(url, { ...init, headers })
      return { response, sentToken: currentTokens.accessToken }
    }

    const { response, sentToken } = await doRequest()
    if (response.status !== 401) {
      return response
    }
    const tokenChanged = await handleOAuth401Error(sentToken).catch(() => false)
    logEvent('tengu_mcp_claudeai_proxy_401', {
      tokenChanged:
        tokenChanged as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (!tokenChanged) {
      const now = getClaudeAIOAuthTokens()?.accessToken
      if (!now || now === sentToken) {
        return response
      }
    }
    try {
      return (await doRequest()).response
    } catch {
      return response
    }
  }
}

export async function createMcpTransport(
  name: string,
  serverRef: ScopedMcpServerConfig,
): Promise<CreatedMcpTransport> {
  let inProcessServer: InProcessMcpServer | undefined

  const sessionIngressToken = getSessionIngressAuthToken()

  if (serverRef.type === 'sse') {
    const authProvider = new ClaudeAuthProvider(name, serverRef)
    const combinedHeaders = await getMcpServerHeaders(name, serverRef)

    const transportOptions: SSEClientTransportOptions = {
      authProvider,
      fetch: wrapFetchWithTimeout(
        wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
      ),
      requestInit: {
        headers: {
          'User-Agent': getMCPUserAgent(),
          ...combinedHeaders,
        },
      },
    }

    transportOptions.eventSourceInit = {
      fetch: async (url: string | URL, init?: RequestInit) => {
        const authHeaders: Record<string, string> = {}
        const tokens = await authProvider.tokens()
        if (tokens) {
          authHeaders.Authorization = `Bearer ${tokens.access_token}`
        }

        const proxyOptions = getProxyFetchOptions()
        return fetch(url, {
          ...init,
          ...proxyOptions,
          headers: {
            'User-Agent': getMCPUserAgent(),
            ...authHeaders,
            ...init?.headers,
            ...combinedHeaders,
            Accept: 'text/event-stream',
          },
        })
      },
    }

    return {
      transport: new SSEClientTransport(new URL(serverRef.url), transportOptions),
    }
  }

  if (serverRef.type === 'sse-ide') {
    logMCPDebug(name, `Setting up SSE-IDE transport to ${serverRef.url}`)
    const proxyOptions = getProxyFetchOptions()
    const transportOptions: SSEClientTransportOptions = proxyOptions.dispatcher
      ? {
          eventSourceInit: {
            fetch: async (url: string | URL, init?: RequestInit) =>
              fetch(url, {
                ...init,
                ...proxyOptions,
                headers: {
                  'User-Agent': getMCPUserAgent(),
                  ...init?.headers,
                },
              }),
          },
        }
      : {}

    return {
      transport: new SSEClientTransport(
        new URL(serverRef.url),
        Object.keys(transportOptions).length > 0 ? transportOptions : undefined,
      ),
    }
  }

  if (serverRef.type === 'ws-ide') {
    const tlsOptions = getWebSocketTLSOptions()
    const wsHeaders = {
      'User-Agent': getMCPUserAgent(),
      ...(serverRef.authToken && {
        'X-Claude-Code-Ide-Authorization': serverRef.authToken,
      }),
    }

    const wsClient =
      typeof Bun !== 'undefined'
        ? ((new globalThis.WebSocket(serverRef.url, {
            protocols: ['mcp'],
            headers: wsHeaders,
            proxy: getWebSocketProxyUrl(serverRef.url),
            tls: tlsOptions || undefined,
          } as unknown as string[])) as WsClientLike)
        : await createNodeWsClient(serverRef.url, {
            headers: wsHeaders,
            agent: getWebSocketProxyAgent(serverRef.url),
            ...(tlsOptions || {}),
          })

    return { transport: new WebSocketTransport(wsClient) }
  }

  if (serverRef.type === 'ws') {
    logMCPDebug(name, `Initializing WebSocket transport to ${serverRef.url}`)
    const combinedHeaders = await getMcpServerHeaders(name, serverRef)
    const tlsOptions = getWebSocketTLSOptions()
    const wsHeaders = {
      'User-Agent': getMCPUserAgent(),
      ...(sessionIngressToken && {
        Authorization: `Bearer ${sessionIngressToken}`,
      }),
      ...combinedHeaders,
    }
    const wsHeadersForLogging = mapValues(wsHeaders, (value, key) =>
      key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
    )

    logMCPDebug(
      name,
      `WebSocket transport options: ${jsonStringify({
        url: serverRef.url,
        headers: wsHeadersForLogging,
        hasSessionAuth: !!sessionIngressToken,
      })}`,
    )

    const wsClient =
      typeof Bun !== 'undefined'
        ? ((new globalThis.WebSocket(serverRef.url, {
            protocols: ['mcp'],
            headers: wsHeaders,
            proxy: getWebSocketProxyUrl(serverRef.url),
            tls: tlsOptions || undefined,
          } as unknown as string[])) as WsClientLike)
        : await createNodeWsClient(serverRef.url, {
            headers: wsHeaders,
            agent: getWebSocketProxyAgent(serverRef.url),
            ...(tlsOptions || {}),
          })

    return { transport: new WebSocketTransport(wsClient) }
  }

  if (serverRef.type === 'http') {
    logMCPDebug(name, `Initializing HTTP transport to ${serverRef.url}`)
    logMCPDebug(
      name,
      `Node version: ${process.version}, Platform: ${process.platform}`,
    )
    logMCPDebug(
      name,
      `Environment: ${jsonStringify({
        NODE_OPTIONS: process.env.NODE_OPTIONS || 'not set',
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || 'default',
        HTTP_PROXY: process.env.HTTP_PROXY || 'not set',
        HTTPS_PROXY: process.env.HTTPS_PROXY || 'not set',
        NO_PROXY: process.env.NO_PROXY || 'not set',
      })}`,
    )

    const authProvider = new ClaudeAuthProvider(name, serverRef)
    const combinedHeaders = await getMcpServerHeaders(name, serverRef)
    const hasOAuthTokens = !!(await authProvider.tokens())
    const proxyOptions = getProxyFetchOptions()

    logMCPDebug(
      name,
      `Proxy options: ${proxyOptions.dispatcher ? 'custom dispatcher' : 'default'}`,
    )

    const transportOptions: StreamableHTTPClientTransportOptions = {
      authProvider,
      fetch: wrapFetchWithTimeout(
        wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
      ),
      requestInit: {
        ...proxyOptions,
        headers: {
          'User-Agent': getMCPUserAgent(),
          ...(sessionIngressToken &&
            !hasOAuthTokens && {
              Authorization: `Bearer ${sessionIngressToken}`,
            }),
          ...combinedHeaders,
        },
      },
    }

    const headersForLogging = transportOptions.requestInit?.headers
      ? mapValues(
          transportOptions.requestInit.headers as Record<string, string>,
          (value, key) =>
            key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
        )
      : undefined

    logMCPDebug(
      name,
      `HTTP transport options: ${jsonStringify({
        url: serverRef.url,
        headers: headersForLogging,
        hasAuthProvider: !!authProvider,
        timeoutMs: MCP_REQUEST_TIMEOUT_MS,
      })}`,
    )

    return {
      transport: new StreamableHTTPClientTransport(
        new URL(serverRef.url),
        transportOptions,
      ),
    }
  }

  if (serverRef.type === 'sdk') {
    throw new Error('SDK servers should be handled in print.ts')
  }

  if (serverRef.type === 'claudeai-proxy') {
    logMCPDebug(
      name,
      `Initializing claude.ai proxy transport for server ${serverRef.id}`,
    )

    const tokens = getClaudeAIOAuthTokens()
    if (!tokens) {
      throw new Error('No claude.ai OAuth token found')
    }

    const oauthConfig = getOauthConfig()
    const proxyUrl = `${oauthConfig.MCP_PROXY_URL}${oauthConfig.MCP_PROXY_PATH.replace('{server_id}', serverRef.id)}`

    logMCPDebug(name, `Using claude.ai proxy at ${proxyUrl}`)

    const fetchWithAuth = createClaudeAiProxyFetch(globalThis.fetch)
    const proxyOptions = getProxyFetchOptions()
    const transportOptions: StreamableHTTPClientTransportOptions = {
      fetch: wrapFetchWithTimeout(fetchWithAuth),
      requestInit: {
        ...proxyOptions,
        headers: {
          'User-Agent': getMCPUserAgent(),
          'X-Mcp-Client-Session-Id': getSessionId(),
        },
      },
    }

    return {
      transport: new StreamableHTTPClientTransport(
        new URL(proxyUrl),
        transportOptions,
      ),
    }
  }

  if ((serverRef.type === 'stdio' || !serverRef.type) && isClaudeInChromeMCPServer(name)) {
    const { createChromeContext } = await import(
      '../../utils/claudeInChrome/mcpServer.js'
    )
    const { createClaudeForChromeMcpServer } = await import(
      '@ant/claude-for-chrome-mcp'
    )
    const { createLinkedTransportPair } = await import('./InProcessTransport.js')
    const context = createChromeContext(serverRef.env)
    inProcessServer = createClaudeForChromeMcpServer(context)
    const [clientTransport, serverTransport] = createLinkedTransportPair()
    await inProcessServer.connect(serverTransport)
    logMCPDebug(name, `In-process Chrome MCP server started`)
    return { transport: clientTransport, inProcessServer }
  }

  if (
    feature('CHICAGO_MCP') &&
    (serverRef.type === 'stdio' || !serverRef.type) &&
    isComputerUseMCPServer?.(name)
  ) {
    const { createComputerUseMcpServerForCli } = await import(
      '../../utils/computerUse/mcpServer.js'
    )
    const { createLinkedTransportPair } = await import('./InProcessTransport.js')
    inProcessServer = await createComputerUseMcpServerForCli()
    const [clientTransport, serverTransport] = createLinkedTransportPair()
    await inProcessServer.connect(serverTransport)
    logMCPDebug(name, `In-process Computer Use MCP server started`)
    return { transport: clientTransport, inProcessServer }
  }

  if (serverRef.type === 'stdio' || !serverRef.type) {
    const finalCommand =
      process.env.CLAUDE_CODE_SHELL_PREFIX || serverRef.command
    const finalArgs = process.env.CLAUDE_CODE_SHELL_PREFIX
      ? [[serverRef.command, ...serverRef.args].join(' ')]
      : serverRef.args

    return {
      transport: new StdioClientTransport({
        command: finalCommand,
        args: finalArgs,
        env: {
          ...subprocessEnv(),
          ...serverRef.env,
        } as Record<string, string>,
        stderr: 'pipe',
      }),
    }
  }

  throw new Error(`Unsupported server type: ${serverRef.type}`)
}
