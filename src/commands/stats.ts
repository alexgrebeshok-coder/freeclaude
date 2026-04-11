#!/usr/bin/env node
/**
 * FreeClaude v2 — Stats command
 * Usage: fc-stats [days]
 *
 * Shows aggregated usage statistics.
 */

import { formatStats, pruneOldEntries } from '../services/usage/usageStore.js'

const args = process.argv.slice(2)
const days = parseInt(args[0] || '7', 10)

if (args.includes('--prune')) {
  const keepDays = parseInt(args[args.indexOf('--prune') + 1] || '30', 10)
  const pruned = pruneOldEntries(keepDays)
  console.log(`Pruned ${pruned} old entries (kept last ${keepDays} days)`)
}

console.log(formatStats(days))
