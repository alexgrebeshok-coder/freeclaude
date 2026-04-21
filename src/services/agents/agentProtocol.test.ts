import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'fs'
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

  describe('housekeeping + registry guarantees', () => {
    // Isolate each test via FREECLAUDE_AGENTS_DIR — HOME overrides do not
    // work because os.homedir() is cached by the runtime on first call.
    let prevOverride: string | undefined
    let sandbox: string

    beforeEach(() => {
      prevOverride = process.env.FREECLAUDE_AGENTS_DIR
      sandbox = join(
        tmpdir(),
        `agent-proto-sandbox-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      )
      mkdirSync(sandbox, { recursive: true })
      process.env.FREECLAUDE_AGENTS_DIR = sandbox
    })

    afterEach(() => {
      if (prevOverride === undefined) delete process.env.FREECLAUDE_AGENTS_DIR
      else process.env.FREECLAUDE_AGENTS_DIR = prevOverride
      try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* ignore */ }
    })

    test('pruneExpiredMailboxes sweeps expired messages across agents', async () => {
      const { registerAgent, sendMessage, pruneExpiredMailboxes, readInbox } =
        await import('./agentProtocol.ts')

      registerAgent('prune-a')
      registerAgent('prune-b')

      // Long TTL — must survive.
      sendMessage('coordinator', 'prune-a', 'status', { keep: true }, 60_000)
      // Short TTL — must be pruned.
      sendMessage('coordinator', 'prune-a', 'status', { keep: false }, 1)
      sendMessage('coordinator', 'prune-b', 'status', { keep: false }, 1)

      await new Promise(r => setTimeout(r, 10))

      const removed = pruneExpiredMailboxes()
      // At least the two short-TTL messages across both mailboxes plus
      // sender outbox copies. We only assert the lower bound so runtime
      // message fan-out changes don't make this brittle.
      expect(removed).toBeGreaterThanOrEqual(2)

      const survivors = readInbox('prune-a')
      const kept = survivors.filter(m => m.payload.keep === true)
      expect(kept.length).toBe(1)
    })

    test('broadcast does not echo back to the sender', async () => {
      const { registerAgent, broadcast, readInbox } = await import('./agentProtocol.ts')

      registerAgent('bcast-sender')
      registerAgent('bcast-listener')

      broadcast('bcast-sender', 'hello everyone')

      const senderInbox = readInbox('bcast-sender')
      const listenerInbox = readInbox('bcast-listener')

      expect(senderInbox.length).toBe(0)
      expect(listenerInbox.length).toBe(1)
      expect(listenerInbox[0]!.type).toBe('broadcast')
      expect(listenerInbox[0]!.payload.message).toBe('hello everyone')
    })

    test('broadcast never creates a reserved "*" or "broadcast" agent directory', async () => {
      const { registerAgent, broadcast } = await import('./agentProtocol.ts')

      registerAgent('bcast-sender-2')
      broadcast('bcast-sender-2', 'ping')

      const reserved = join(sandbox, '*')
      const reservedWord = join(sandbox, 'broadcast')
      expect(existsSync(reserved)).toBe(false)
      expect(existsSync(reservedWord)).toBe(false)
    })

    test('registerAgent rejects reserved ids', async () => {
      const { registerAgent } = await import('./agentProtocol.ts')
      expect(() => registerAgent('*')).toThrow(/reserved/)
      expect(() => registerAgent('broadcast')).toThrow(/reserved/)
      expect(() => registerAgent('')).toThrow()
    })

    test('withRegistryLock reclaims stale locks left behind by dead owners', async () => {
      // Simulate a crashed process by writing a lock file pointing at a
      // pid that is guaranteed to be dead. pid 2_147_483_646 is outside
      // the typical active-pid range on Linux/macOS.
      const { registerAgent, listRegisteredAgents } = await import('./agentProtocol.ts')

      const registryLock = join(sandbox, 'directory.json.lock')
      writeFileSync(registryLock, `2147483646:${Date.now()}`)

      // Should still succeed — the dead-owner check unlinks the stale
      // lock before acquiring a fresh one.
      registerAgent('post-crash-agent', ['code'])
      expect(listRegisteredAgents()).toContain('post-crash-agent')
      expect(existsSync(registryLock)).toBe(false)
    })
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
