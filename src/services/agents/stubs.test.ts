import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import forkCommand, { register as registerForkCommand } from '../../commands/fork/index.ts'
import { call as callForkCommand } from '../../commands/fork/fork.ts'
import { UserForkBoilerplateMessage } from '../../components/messages/UserForkBoilerplateMessage.tsx'
import { getCoordinatorAgents, workerAgent } from '../../coordinator/workerAgent.ts'

describe('FreeClaude inherited stubs', () => {
  test('fork command stub is a safe no-op', () => {
    expect(registerForkCommand()).toBeUndefined()
  })

  test('fork command stub exposes a safe runtime shim', async () => {
    expect(forkCommand.name).toBe('fork')
    expect(forkCommand.supportsNonInteractive).toBe(false)
    const result = await callForkCommand()
    expect(result.type).toBe('text')
    expect(result.value).toContain('not available in FreeClaude yet')
  })

  test('workerAgent stub stays disabled in FreeClaude', () => {
    expect(getCoordinatorAgents()).toEqual([])
    expect(workerAgent.isAvailable()).toBe(false)
    expect(() => workerAgent.spawn()).toThrow('workerAgent not available in FreeClaude')
  })

  test('UserForkBoilerplateMessage stub renders nothing', () => {
    expect(UserForkBoilerplateMessage({})).toBeNull()
  })

  test('all inherited import points have concrete files behind them', () => {
    const repoRoot = join(import.meta.dir, '../../..')
    const commandStub = join(repoRoot, 'src/commands/fork/index.ts')
    const workerStub = join(repoRoot, 'src/coordinator/workerAgent.ts')
    const messageStub = join(repoRoot, 'src/components/messages/UserForkBoilerplateMessage.tsx')

    expect(existsSync(commandStub)).toBe(true)
    expect(existsSync(workerStub)).toBe(true)
    expect(existsSync(messageStub)).toBe(true)

    const commandsSource = readFileSync(join(repoRoot, 'src/commands.ts'), 'utf8')
    const builtInAgentsSource = readFileSync(
      join(repoRoot, 'src/tools/AgentTool/builtInAgents.ts'),
      'utf8',
    )
    const userTextMessageSource = readFileSync(
      join(repoRoot, 'src/components/messages/UserTextMessage.tsx'),
      'utf8',
    )

    expect(commandsSource).toContain("./commands/fork/index.js")
    expect(builtInAgentsSource).toContain("../../coordinator/workerAgent.js")
    expect(userTextMessageSource).toContain("./UserForkBoilerplateMessage.js")
  })
})
