#!/usr/bin/env node
/**
 * FreeClaude v2 — Debug command
 * Usage: fc debug "bug description" [--file path/to/file.ts]
 */

import { quickDebug, DebugAgent } from '../services/debug/debugAgent.js'

const args = process.argv.slice(2)

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
FreeClaude v2 — Debug Agent

Usage:
  fc debug "bug description" [--file path/to/file.ts]

Options:
  --file, -f  Target file for instrumentation suggestions
  --help, -h  Show this help

Examples:
  fc debug "API returns 500 on POST /users"
  fc debug "null pointer when user not logged in" --file src/auth.ts
`)
  process.exit(0)
}

// Parse args
const fileIdx = args.indexOf('--file')
const shortFileIdx = args.indexOf('-f')
const fileArgIdx = fileIdx >= 0 ? fileIdx : shortFileIdx
const targetFile = fileArgIdx >= 0 ? args[fileArgIdx + 1] : undefined
const description = args.filter(a => !a.startsWith('-') && a !== (targetFile || ''))[0] || args[0]

if (description.startsWith('--') || description.startsWith('-')) {
  console.error('❌ Please provide a bug description')
  console.error('Usage: fc debug "bug description" [--file path/to/file.ts]')
  process.exit(1)
}

console.log(`\n🐛 Analyzing: ${description}\n`)

quickDebug(description, targetFile).then(summary => {
  console.log(summary)
})
