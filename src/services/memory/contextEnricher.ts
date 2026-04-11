/**
 * FreeClaude v2 — Context Enricher
 *
 * Enriches system prompts with GBrain search results.
 * Automatically adds relevant project context before each request.
 */

import { searchGBrain, isGBrainAvailable, type GBrainResult } from './gbrainClient.js'

const MAX_CONTEXT_CHARS = 4000 // Don't bloat the prompt too much
const CONTEXT_HEADER = '\n\n[FreeClaude Memory — relevant context from GBrain]\n'
const CONTEXT_FOOTER = '\n[End of GBrain context]\n'

// Track which queries we've already enriched (avoid re-searching same context)
const recentQueries = new Map<string, GBrainResult[]>()
const MAX_RECENT = 20

/**
 * Build an enriched system prompt with GBrain context.
 */
export async function enrichContext(
  userMessage: string,
): Promise<{ enrichedSystemPrompt: string; sources: string[] }> {
  if (!isGBrainAvailable()) {
    return { enrichedSystemPrompt: '', sources: [] }
  }

  // Extract key terms from user message for search
  const searchQuery = extractSearchQuery(userMessage)

  // Check if we recently searched for similar context
  const cached = findSimilarCachedQuery(searchQuery)
  if (cached) {
    const prompt = buildContextPrompt(cached)
    return {
      enrichedSystemPrompt: prompt,
      sources: cached.map(r => r.source),
    }
  }

  // Search GBrain
  const results = await searchGBrain(searchQuery, {
    topK: 5,
    threshold: 0.5,
    mode: 'hybrid',
  })

  if (results.length === 0) {
    return { enrichedSystemPrompt: '', sources: [] }
  }

  // Cache results
  recentQueries.set(searchQuery, results)
  if (recentQueries.size > MAX_RECENT) {
    const firstKey = recentQueries.keys().next().value
    if (firstKey) recentQueries.delete(firstKey)
  }

  const prompt = buildContextPrompt(results)
  return {
    enrichedSystemPrompt: prompt,
    sources: results.map(r => r.source),
  }
}

/**
 * Extract a search query from user message.
 * Removes common filler words and keeps meaningful terms.
 */
function extractSearchQuery(message: string): string {
  // Take first ~200 chars, remove common noise
  const cleaned = message
    .slice(0, 200)
    .replace(/^(что|как|почему|сделай|напиши|проверь|запусти|покажи|расскажи|explain|write|fix|create|show|tell me)\s*/i, '')
    .trim()

  // If too short after cleaning, use original (truncated)
  return cleaned.length > 10 ? cleaned : message.slice(0, 100)
}

/**
 * Find a similar cached query.
 */
function findSimilarCachedQuery(query: string): GBrainResult[] | null {
  const normalized = query.toLowerCase()

  for (const [cachedQuery, results] of recentQueries) {
    if (
      cachedQuery.toLowerCase().includes(normalized) ||
      normalized.includes(cachedQuery.toLowerCase())
    ) {
      return results
    }
  }

  return null
}

/**
 * Build the context prompt from results.
 */
function buildContextPrompt(results: GBrainResult[]): string {
  let context = ''
  let totalChars = 0

  for (const result of results) {
    const entry = `- [${result.source}] (score: ${result.score.toFixed(2)}): ${result.content}\n`
    if (totalChars + entry.length > MAX_CONTEXT_CHARS) break
    context += entry
    totalChars += entry.length
  }

  return CONTEXT_HEADER + context + CONTEXT_FOOTER
}
