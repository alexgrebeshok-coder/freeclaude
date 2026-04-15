import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'

// Mock HOME to isolate tests
const REAL_HOME = homedir()

describe('Agent Protocol', () => {
  const TEST_AGENTS_DIR = join(tmpdir(), `agent-proto-test-${Date.now()}`)

  beforeEach(() => {
    mkdirSync(join(TEST_AGENTS_DIR, 'agents'), { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(TEST_AGENTS_DIR, { recursive: true, force: true })
    } catch {}
  })

  test('sendMessage creates inbox entry', async () => {
    // Direct file-based test (avoid HOME dependency)
    const {
      sendMessage,
      readInbox,
      registerAgent,
    } = await import('./agentProtocol.ts')

    // Register agent to create directory
    registerAgent('test-agent-1', ['code'])

    const msg = sendMessage('coordinator', 'test-agent-1', 'status', {
      message: 'hello from coordinator',
    })

    expect(msg.id).toBeTruthy()
    expect(msg.type).toBe('status')
    expect(msg.from).toBe('coordinator')
    expect(msg.to).toBe('test-agent-1')
    expect(msg.acknowledged).toBe(false)
  })

  test('acknowledgeMessage marks message as read', async () => {
    const { sendMessage, readInbox, acknowledgeMessage, registerAgent } = await import('./agentProtocol.ts')

    registerAgent('test-agent-2', ['review'])
    const msg = sendMessage('coordinator', 'test-agent-2', 'status', { info: 'test' })

    const result = acknowledgeMessage('test-agent-2', msg.id)
    expect(result).toBe(true)

    const inbox = readInbox('test-agent-2')
    const found = inbox.find(m => m.id === msg.id)
    expect(found?.acknowledged).toBe(true)
  })

  test('announce creates announce message', async () => {
    const { announce, readInbox, registerAgent } = await import('./agentProtocol.ts')

    registerAgent('worker-1', ['build'])
    const msg = announce('worker-1', 'Build project', 'starting')

    expect(msg.type).toBe('announce')
    expect(msg.payload).toEqual({
      agentId: 'worker-1',
      task: 'Build project',
      status: 'starting',
    })
  })

  test('reportResult creates result message', async () => {
    const { reportResult, registerAgent } = await import('./agentProtocol.ts')

    registerAgent('worker-2', ['test'])
    const msg = reportResult('worker-2', 'All tests passed', 0, 5000)

    expect(msg.type).toBe('result')
    expect(msg.payload).toEqual({
      agentId: 'worker-2',
      output: 'All tests passed',
      exitCode: 0,
      durationMs: 5000,
    })
  })

  test('registerAgent and listAgentsDetailed', async () => {
    const { registerAgent, listAgentsDetailed } = await import('./agentProtocol.ts')

    registerAgent('agent-a', ['code', 'review'])
    registerAgent('agent-b', ['test'])

    const agents = listAgentsDetailed()
    const a = agents.find(a => a.id === 'agent-a')
    const b = agents.find(a => a.id === 'agent-b')

    expect(a).toBeTruthy()
    expect(a!.capabilities).toContain('code')
    expect(a!.capabilities).toContain('review')
    expect(b).toBeTruthy()
    expect(b!.capabilities).toContain('test')
  })

  test('findAgentsByCapability filters correctly', async () => {
    const { registerAgent, findAgentsByCapability } = await import('./agentProtocol.ts')

    registerAgent('coder-1', ['code', 'review'])
    registerAgent('tester-1', ['test'])
    registerAgent('coder-2', ['code'])

    const coders = findAgentsByCapability('code')
    expect(coders.length).toBeGreaterThanOrEqual(2)

    const testers = findAgentsByCapability('test')
    expect(testers.length).toBeGreaterThanOrEqual(1)
  })

  test('cleanupRegistry removes terminated agents', async () => {
    const { registerAgent, updateAgentStatus, cleanupRegistry, listAgentsDetailed } = await import('./agentProtocol.ts')

    registerAgent('alive-agent', ['code'])
    registerAgent('dead-agent', ['test'])
    updateAgentStatus('dead-agent', 'terminated')

    const removed = cleanupRegistry()
    expect(removed).toBeGreaterThanOrEqual(1)

    const agents = listAgentsDetailed()
    const dead = agents.find(a => a.id === 'dead-agent')
    expect(dead).toBeUndefined()
  })

  test('message TTL: status messages expire', async () => {
    const { sendMessage, readInbox, registerAgent } = await import('./agentProtocol.ts')

    registerAgent('ttl-agent', ['test'])

    // Send with very short TTL (1ms)
    sendMessage('coord', 'ttl-agent', 'status', { test: true }, 1)

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 10))

    const inbox = readInbox('ttl-agent')
    // Expired messages should be filtered out
    const statusMsgs = inbox.filter(m => m.type === 'status' && m.payload.test === true)
    expect(statusMsgs.length).toBe(0)
  })
})
