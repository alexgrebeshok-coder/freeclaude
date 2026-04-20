/**
 * FreeClaude v3 — Agent Protocol
 *
 * Simple JSON-based announce/collect protocol for agent coordination.
 * Agents announce their tasks, report results, and the coordinator
 * collects and routes messages.
 *
 * Storage: ~/.freeclaude/agents/{agentId}/inbox.json, outbox.json
 * Integrates with inherited SendMessageTool mailbox system.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentMessageType = 'announce' | 'result' | 'status' | 'error' | 'broadcast'

export interface AgentMessage {
  id: string
  type: AgentMessageType
  from: string
  to: string          // agent ID or 'coordinator' or '*' for broadcast
  payload: Record<string, unknown>
  timestamp: string
  ttlMs: number       // Time-to-live in milliseconds
  acknowledged: boolean
}

export interface AgentAnnounce {
  agentId: string
  task: string
  status: 'starting' | 'running' | 'completed' | 'failed'
  provider?: string
  model?: string
}

export interface AgentResult {
  agentId: string
  output: string
  exitCode: number
  durationMs: number
  tokensUsed?: number
}

// ---------------------------------------------------------------------------
// Message IDs
// ---------------------------------------------------------------------------

// Counter-based IDs reset on process restart and could collide across
// concurrent worker processes writing to the same shared mailbox. Use a
// real UUID so IDs stay unique across restarts, processes, and machines.
function genMsgId(): string {
  return `msg-${Date.now()}-${randomUUID()}`
}

// Reserved agent identifiers — never create a directory for these.
const RESERVED_AGENT_IDS = new Set(['*', 'broadcast'])

const MAX_OUTBOX_MESSAGES = 500

// ---------------------------------------------------------------------------
// Agent directory
// ---------------------------------------------------------------------------

function agentsDir(): string {
  return join(homedir(), '.freeclaude', 'agents')
}

function agentDir(agentId: string): string {
  return join(agentsDir(), agentId)
}

function ensureAgentDir(agentId: string): void {
  if (!agentId || RESERVED_AGENT_IDS.has(agentId)) return
  const dir = agentDir(agentId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

// ---------------------------------------------------------------------------
// Inbox / Outbox
// ---------------------------------------------------------------------------

function inboxPath(agentId: string): string {
  return join(agentDir(agentId), 'inbox.json')
}

function outboxPath(agentId: string): string {
  return join(agentDir(agentId), 'outbox.json')
}

function readMessages(path: string): AgentMessage[] {
  try {
    if (!existsSync(path)) return []
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return []
  }
}

function writeMessages(path: string, messages: AgentMessage[]): void {
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // Atomic write via rename so a concurrent reader never observes a
  // half-written JSON file — at worst they read the previous snapshot.
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(messages, null, 2), 'utf-8')
  renameSync(tmp, path)
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

const DEFAULT_STATUS_TTL = 5 * 60 * 1000    // 5 minutes for status updates
const DEFAULT_RESULT_TTL = 60 * 60 * 1000   // 1 hour for results

/**
 * Send a message to an agent's inbox.
 */
export function sendMessage(
  from: string,
  to: string,
  type: AgentMessageType,
  payload: Record<string, unknown>,
  ttlMs?: number,
): AgentMessage {
  if (!from) {
    throw new Error('sendMessage: "from" agent id is required')
  }
  if (!to) {
    throw new Error('sendMessage: "to" agent id is required (use "*" for broadcast)')
  }

  // Don't materialise a bogus "broadcast" directory — the previous
  // behaviour polluted the agents dir with an empty folder that never
  // got cleaned up.
  if (to !== '*') ensureAgentDir(to)

  const msg: AgentMessage = {
    id: genMsgId(),
    type,
    from,
    to,
    payload,
    timestamp: new Date().toISOString(),
    ttlMs: ttlMs ?? (type === 'result' ? DEFAULT_RESULT_TTL : DEFAULT_STATUS_TTL),
    acknowledged: false,
  }

  if (to === '*') {
    // Broadcast — fan out to every active registered agent (skipping
    // the sender so an agent doesn't receive its own broadcast).
    for (const agentId of listRegisteredAgents()) {
      if (agentId === from) continue
      const inbox = readMessages(inboxPath(agentId))
      if (inbox.some(existing => existing.id === msg.id)) continue
      inbox.push(msg)
      writeMessages(inboxPath(agentId), inbox)
    }
  } else {
    const inbox = readMessages(inboxPath(to))
    if (!inbox.some(existing => existing.id === msg.id)) {
      inbox.push(msg)
      writeMessages(inboxPath(to), inbox)
    }
  }

  // Record in the sender's outbox, pruned to a sane cap so the file
  // doesn't grow without bound over long-running sessions.
  ensureAgentDir(from)
  const outbox = readMessages(outboxPath(from))
  outbox.push(msg)
  const trimmed = outbox.length > MAX_OUTBOX_MESSAGES
    ? outbox.slice(-MAX_OUTBOX_MESSAGES)
    : outbox
  writeMessages(outboxPath(from), trimmed)

  return msg
}

/**
 * Read messages from an agent's inbox.
 * Automatically removes expired messages.
 */
export function readInbox(agentId: string): AgentMessage[] {
  const inbox = readMessages(inboxPath(agentId))
  const now = Date.now()

  // Filter expired messages
  const active = inbox.filter(msg => {
    const msgTime = new Date(msg.timestamp).getTime()
    return now - msgTime < msg.ttlMs
  })

  // Write back if we removed expired messages
  if (active.length !== inbox.length) {
    writeMessages(inboxPath(agentId), active)
  }

  return active
}

/**
 * Acknowledge a message (mark as read).
 */
export function acknowledgeMessage(agentId: string, messageId: string): boolean {
  const inbox = readMessages(inboxPath(agentId))
  const msg = inbox.find(m => m.id === messageId)
  if (!msg) return false

  msg.acknowledged = true
  writeMessages(inboxPath(agentId), inbox)
  return true
}

/**
 * Create an announce message.
 */
export function announce(agentId: string, task: string, status: AgentAnnounce['status']): AgentMessage {
  return sendMessage(agentId, 'coordinator', 'announce', {
    agentId,
    task,
    status,
  })
}

/**
 * Report a result.
 */
export function reportResult(agentId: string, output: string, exitCode: number, durationMs: number): AgentMessage {
  return sendMessage(agentId, 'coordinator', 'result', {
    agentId,
    output,
    exitCode,
    durationMs,
  }, DEFAULT_RESULT_TTL)
}

/**
 * Broadcast a message to all agents.
 */
export function broadcast(from: string, message: string): AgentMessage {
  return sendMessage(from, '*', 'broadcast', { message })
}

// ---------------------------------------------------------------------------
// Agent registry
// ---------------------------------------------------------------------------

interface AgentRegistryEntry {
  id: string
  capabilities: string[]
  status: 'active' | 'idle' | 'terminated'
  registeredAt: string
  lastSeenAt: string
}

function registryPath(): string {
  return join(agentsDir(), 'directory.json')
}

function loadRegistry(): AgentRegistryEntry[] {
  try {
    if (!existsSync(registryPath())) return []
    return JSON.parse(readFileSync(registryPath(), 'utf-8'))
  } catch {
    return []
  }
}

function saveRegistry(entries: AgentRegistryEntry[]): void {
  const dir = agentsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = registryPath()
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8')
  renameSync(tmp, path)
}

/**
 * Register an agent in the directory.
 */
export function registerAgent(id: string, capabilities: string[] = []): void {
  if (!id || RESERVED_AGENT_IDS.has(id)) {
    throw new Error(`registerAgent: "${id}" is a reserved agent id`)
  }
  const registry = loadRegistry()
  const existing = registry.findIndex(e => e.id === id)
  const now = new Date().toISOString()

  if (existing >= 0) {
    registry[existing] = {
      ...registry[existing]!,
      capabilities,
      status: 'active',
      lastSeenAt: now,
    }
  } else {
    registry.push({
      id,
      capabilities,
      status: 'active',
      registeredAt: now,
      lastSeenAt: now,
    })
  }

  saveRegistry(registry)
}

/**
 * Update agent status.
 */
export function updateAgentStatus(id: string, status: AgentRegistryEntry['status']): void {
  const registry = loadRegistry()
  const entry = registry.find(e => e.id === id)
  if (entry) {
    entry.status = status
    entry.lastSeenAt = new Date().toISOString()
    saveRegistry(registry)
  }
}

/**
 * Find agents by capability.
 */
export function findAgentsByCapability(capability: string): AgentRegistryEntry[] {
  return loadRegistry().filter(e =>
    e.status === 'active' && e.capabilities.includes(capability),
  )
}

/**
 * List all registered agents.
 */
export function listRegisteredAgents(): string[] {
  return loadRegistry()
    .filter(e => e.status === 'active')
    .map(e => e.id)
}

/**
 * Permanently drop an agent from the registry and remove its mailbox
 * directory. Safe to call for unknown ids.
 */
export function unregisterAgent(id: string): boolean {
  if (!id || RESERVED_AGENT_IDS.has(id)) return false
  const registry = loadRegistry()
  const next = registry.filter(e => e.id !== id)
  const removed = next.length !== registry.length
  if (removed) saveRegistry(next)
  try {
    const dir = agentDir(id)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup; leaving the directory behind is non-fatal.
  }
  return removed
}

/**
 * List all agents with full details.
 */
export function listAgentsDetailed(): AgentRegistryEntry[] {
  return loadRegistry()
}

/**
 * Clean up terminated agents from registry.
 */
export function cleanupRegistry(): number {
  const registry = loadRegistry()
  const active = registry.filter(e => e.status !== 'terminated')
  const removed = registry.length - active.length
  if (removed > 0) saveRegistry(active)
  return removed
}
