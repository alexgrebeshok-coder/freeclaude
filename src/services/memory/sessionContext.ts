/**
 * FreeClaude v3 — Session Context Loader
 *
 * Automatically loads query-aware memory and recent notes into the system prompt.
 * Called by openaiShim before every request so the model gets the highest-signal
 * persistent context without dragging the whole memory dump into every prompt.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  ENV_MEMORY_DIR,
  listRelevantMemories,
  pruneExpiredMemories,
  resolveMemoryProjectKey,
  type MemoryEntry,
} from './memoryStore.js'

const QUERY_MIN_CHARS = 12
const MAX_RETRIEVED_ITEMS = 8
const MAX_CONTEXT_CHARS = 4000
const MAX_ITEM_CHARS = 420
const MAX_MEMORYS_PER_CATEGORY = 2

type ContextCandidate = {
  id: string
  source: 'memory' | 'note' | 'gbrain'
  title: string
  content: string
  score: number
  updatedAt?: string
}

function resolveFreeClaudeHome(): string {
  return process.env[ENV_MEMORY_DIR] || join(homedir(), '.freeclaude')
}

function getDailyDir(): string {
  return join(resolveFreeClaudeHome(), 'daily')
}

function getToday(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function truncateText(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLen) {
    return normalized
  }
  return normalized.slice(0, maxLen - 3).trimEnd() + '...'
}

function tokenizeQuery(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .filter(token => token.length >= 3),
  )]
}

function scoreTextMatch(query: string, text: string): number {
  const normalizedText = text.toLowerCase()
  const normalizedQuery = query.toLowerCase().trim()
  if (!normalizedText || !normalizedQuery) {
    return 0
  }

  let score = 0
  if (normalizedText.includes(normalizedQuery)) {
    score += 6
  }

  const tokens = tokenizeQuery(normalizedQuery)
  if (tokens.length === 0) {
    return score
  }

  let matched = 0
  for (const token of tokens) {
    if (normalizedText.includes(token)) {
      matched += 1
      score += token.length >= 6 ? 1.4 : 1
    }
  }

  score += matched / tokens.length
  return score
}

function recencyBoost(updatedAt?: string): number {
  if (!updatedAt) return 0
  const ageMs = Date.now() - new Date(updatedAt).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0

  const ageDays = ageMs / 86_400_000
  if (ageDays <= 1) return 1.4
  if (ageDays <= 7) return 0.9
  if (ageDays <= 30) return 0.4
  return 0
}

function chunkMarkdown(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return []
  }

  const rawSections = normalized
    .split(/\n{2,}/)
    .map(section => section.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current = ''

  for (const section of rawSections) {
    const candidate = current ? `${current}\n\n${section}` : section
    if (candidate.length <= 700) {
      current = candidate
      continue
    }

    if (current) {
      chunks.push(current)
      current = ''
    }

    if (section.length <= 700) {
      current = section
      continue
    }

    for (let i = 0; i < section.length; i += 700) {
      chunks.push(section.slice(i, i + 700))
    }
  }

  if (current) {
    chunks.push(current)
  }

  return chunks
}

function loadCompactMemories(projectKey: string): string {
  const entries = listRelevantMemories({ projectKey })
  if (entries.length === 0) return ''

  const lines = ['## Persistent memory:']
  const grouped = new Map<string, MemoryEntry[]>()

  for (const entry of entries) {
    if (entry.tags?.includes('система') || entry.tags?.includes('freeclaude')) {
      continue
    }
    const category = entry.category || 'general'
    const bucket = grouped.get(category) ?? []
    if (bucket.length >= MAX_MEMORYS_PER_CATEGORY) {
      continue
    }
    bucket.push(entry)
    grouped.set(category, bucket)
  }

  for (const [category, items] of grouped.entries()) {
    lines.push(`### ${category}`)
    for (const entry of items) {
      const scopeLabel =
        entry.scope === 'project' && entry.projectKey === projectKey
          ? ' (project)'
          : entry.scope === 'global'
            ? ''
            : ` (${entry.scope})`
      lines.push(`- ${entry.key}${scopeLabel}: ${truncateText(entry.value, 220)}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

function loadFallbackDailyNotes(projectKey: string): string {
  const dates = [getToday(), getYesterday()]
  const sections: string[] = []
  const roots = [join(getDailyDir(), projectKey), getDailyDir()]

  for (const date of dates) {
    for (const root of roots) {
      const filePath = join(root, `${date}.md`)
      if (!existsSync(filePath)) continue

      try {
        const content = readFileSync(filePath, 'utf-8')
        sections.push(`### ${date}\n${truncateText(content, 1200)}`)
        break
      } catch {
        // Skip unreadable notes
      }
    }
  }

  if (sections.length === 0) return ''
  return `## Recent conversation history:\n${sections.join('\n\n')}`
}

function loadRecentDailyFiles(projectKey: string): Array<{
  id: string
  title: string
  content: string
  updatedAt: string
}> {
  const files: Array<{
    path: string
    title: string
    updatedAt: string
  }> = []
  const roots = [join(getDailyDir(), projectKey), getDailyDir()]

  for (const root of roots) {
    if (!existsSync(root)) continue
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const fullPath = join(root, entry.name)
        const stat = statSync(fullPath)
        files.push({
          path: fullPath,
          title: entry.name.replace(/\.md$/, ''),
          updatedAt: stat.mtime.toISOString(),
        })
      }
    } catch {
      // Ignore unreadable roots
    }
  }

  return files
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 6)
    .flatMap(file => {
      try {
        return [
          {
            id: file.path,
            title: file.title,
            content: readFileSync(file.path, 'utf-8'),
            updatedAt: file.updatedAt,
          },
        ]
      } catch {
        return []
      }
    })
}

async function loadSemanticBoosts(query: string): Promise<Map<string, number>> {
  const boosts = new Map<string, number>()

  try {
    const { semanticSearch } = await import('./semanticSearch.js')
    const results = await semanticSearch(query, 5)
    for (const result of results) {
      const key = `${result.key}::${result.value}`
      boosts.set(key, result.score * 5)
    }
  } catch {
    // Semantic retrieval is best-effort
  }

  return boosts
}

function buildMemoryCandidates(
  query: string,
  projectKey: string,
  semanticBoosts: Map<string, number>,
): ContextCandidate[] {
  const entries = listRelevantMemories({ projectKey })
  const candidates: ContextCandidate[] = []

  for (const entry of entries) {
    if (entry.tags?.includes('система') || entry.tags?.includes('freeclaude')) {
      continue
    }

    const searchableText = [
      entry.key,
      entry.value,
      entry.tags?.join(' '),
      entry.category,
      entry.projectKey,
    ]
      .filter(Boolean)
      .join('\n')

    const score =
      scoreTextMatch(query, searchableText) +
      recencyBoost(entry.updatedAt) +
      (semanticBoosts.get(`${entry.key}::${entry.value}`) ?? 0)

    if (score <= 0) {
      continue
    }

    candidates.push({
      id: `memory:${entry.key}:${entry.updatedAt}`,
      source: 'memory',
      title: entry.key,
      content: entry.value,
      score,
      updatedAt: entry.updatedAt,
    })
  }

  return candidates
}

function buildNoteCandidates(query: string, projectKey: string): ContextCandidate[] {
  const files = loadRecentDailyFiles(projectKey)
  const candidates: ContextCandidate[] = []

  for (const file of files) {
    const chunks = chunkMarkdown(file.content)
    chunks.forEach((chunk, index) => {
      const score =
        scoreTextMatch(query, `${file.title}\n${chunk}`) + recencyBoost(file.updatedAt)
      if (score <= 0) {
        return
      }

      candidates.push({
        id: `note:${file.id}:${index}`,
        source: 'note',
        title: file.title,
        content: chunk,
        score,
        updatedAt: file.updatedAt,
      })
    })
  }

  return candidates
}

async function loadGBrainCandidates(query: string): Promise<ContextCandidate[]> {
  try {
    const { isGBrainAvailable, searchGBrain } = await import('./gbrainClient.js')
    if (!isGBrainAvailable()) {
      return []
    }

    const results = await searchGBrain(query, {
      topK: 5,
      threshold: 0.35,
      mode: 'hybrid',
    })

    return results.map(result => ({
      id: `gbrain:${result.source}:${result.content}`,
      source: 'gbrain',
      title: result.source,
      content: result.content,
      score: result.score * 10,
    }))
  } catch {
    return []
  }
}

function formatRetrievedContext(candidates: ContextCandidate[]): string {
  if (candidates.length === 0) {
    return ''
  }

  const groups = new Map<ContextCandidate['source'], ContextCandidate[]>()
  for (const candidate of candidates) {
    const bucket = groups.get(candidate.source) ?? []
    bucket.push(candidate)
    groups.set(candidate.source, bucket)
  }

  const labels: Record<ContextCandidate['source'], string> = {
    memory: 'Persistent memory',
    note: 'Recent notes',
    gbrain: 'Indexed docs',
  }

  const lines = ['## Relevant retrieved context:']
  let charCount = lines.join('\n').length

  for (const source of ['memory', 'note', 'gbrain'] as const) {
    const items = groups.get(source)
    if (!items?.length) continue

    lines.push(`### ${labels[source]}`)
    charCount += labels[source].length + 6

    for (const item of items) {
      const rendered = `- ${item.title}: ${truncateText(item.content, MAX_ITEM_CHARS)}`
      if (charCount + rendered.length > MAX_CONTEXT_CHARS) {
        return lines.join('\n').trim()
      }
      lines.push(rendered)
      charCount += rendered.length + 1
    }

    lines.push('')
    charCount += 1
  }

  return lines.join('\n').trim()
}

async function buildRetrievedContext(
  query: string,
  projectKey: string,
): Promise<string> {
  const semanticBoosts = await loadSemanticBoosts(query)
  const candidates = [
    ...buildMemoryCandidates(query, projectKey, semanticBoosts),
    ...buildNoteCandidates(query, projectKey),
    ...(await loadGBrainCandidates(query)),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RETRIEVED_ITEMS)

  return formatRetrievedContext(candidates)
}

/**
 * Main entry point — builds the session context block.
 * This gets injected into the system prompt automatically.
 */
export async function loadSessionContext(query?: string): Promise<string> {
  pruneExpiredMemories()
  const projectKey = resolveMemoryProjectKey()
  const parts: string[] = []

  const trimmedQuery = query?.trim() ?? ''
  if (trimmedQuery.length >= QUERY_MIN_CHARS) {
    const retrieved = await buildRetrievedContext(trimmedQuery, projectKey)
    if (retrieved) {
      parts.push(retrieved)
    }
  }

  const memories = loadCompactMemories(projectKey)
  if (memories) {
    parts.push(memories)
  }

  if (trimmedQuery.length < QUERY_MIN_CHARS || parts.length === 0) {
    const fallbackDaily = loadFallbackDailyNotes(projectKey)
    if (fallbackDaily) {
      parts.push(fallbackDaily)
    }
  }

  if (parts.length === 0) return ''

  return `<freeclaude-memory>
This is your persistent memory from previous sessions. Use this context to remember the user, their preferences, project decisions, and the most relevant prior context for the current request.

${parts.join('\n\n')}

</freeclaude-memory>`
}
