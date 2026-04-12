import type { LocalCommandCall } from '../../types/command.js'
import { forget as forgetEntry } from '../../services/memory/memoryStore.js'

export const call: LocalCommandCall = async (args) => {
  const key = args.trim()

  if (!key) {
    return {
      type: 'text',
      value: 'Usage: /forget <key>',
    }
  }

  const deleted = forgetEntry(key)
  if (deleted) {
    return {
      type: 'text',
      value: `🗑 Forgot: ${key}`,
    }
  }

  return {
    type: 'text',
    value: `Nothing found for "${key}".`,
  }
}
