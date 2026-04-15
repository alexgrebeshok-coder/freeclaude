import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import forkCommand, { register as registerForkCommand } from '../../commands/fork/index.ts'
import { executeForkCommand } from '../../commands/fork/fork.ts'
import { UserForkBoilerplateMessage } from '../../components/messages/UserForkBoilerplateMessage.tsx'
import {
  COORDINATOR_WORKER_AGENT,
  getCoordinatorAgents,
  workerAgent,
} from '../../coordinator/workerAgent.ts'
import { buildChildMessage } from '../../tools/AgentTool/forkSubagent.ts'
import { asSystemPrompt } from '../../utils/systemPromptType.ts'

describe('FreeClaude inherited coordinator wiring', () => {
  test('fork command keeps legacy register shim', () => {
    expect(registerForkCommand()).toBeUndefined()
  })

  test('fork command validates usage and can execute through runForkedAgent', async () => {
    expect(forkCommand.name).toBe('fork')
    expect(forkCommand.supportsNonInteractive).toBe(false)

    const usage = await executeForkCommand(
      '',
      { messages: [] } as unknown as Parameters<typeof executeForkCommand>[1],
    )
    expect(usage).toEqual({
      type: 'text',
      value: 'Usage: /fork <directive>',
    })

    const result = await executeForkCommand(
      'Investigate auth regression',
      { messages: [] } as unknown as Parameters<typeof executeForkCommand>[1],
      {
        getSavedCacheSafeParams: () => ({
          systemPrompt: asSystemPrompt(['system prompt']),
          userContext: {},
          systemContext: {},
          toolUseContext: {} as never,
          forkContextMessages: [],
        }),
        runFork: async params => {
          const prompt = params.promptMessages[0]
          expect(prompt?.type).toBe('user')
          expect(prompt?.message.content).toContain('<fork-boilerplate>')
          expect(prompt?.message.content).toContain('Investigate auth regression')
          return {
            messages: [
              {
                type: 'assistant',
                uuid: 'assistant-1',
                message: {
                  role: 'assistant',
                  content: [{ type: 'text', text: 'Scope: auth\nResult: fixed.' }],
                  stop_reason: 'end_turn',
                  usage: undefined,
                },
              } as never,
            ],
            totalUsage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          }
        },
      },
    )

    expect(result.type).toBe('text')
    expect(result.value).toContain('Scope: auth')
  })

  test('workerAgent exposes a real coordinator worker definition', () => {
    expect(getCoordinatorAgents()).toEqual([])
    expect(COORDINATOR_WORKER_AGENT.agentType).toBe('worker')
    expect(COORDINATOR_WORKER_AGENT.tools).not.toContain('Task')
    expect(COORDINATOR_WORKER_AGENT.tools).not.toContain('TaskStop')
    expect(workerAgent.isAvailable()).toBe(false)
    expect(() => workerAgent.spawn()).toThrow(
      'Use the Agent tool to spawn coordinator workers',
    )
  })

  test('UserForkBoilerplateMessage renders the fork directive', () => {
    const element = UserForkBoilerplateMessage({
      addMargin: false,
      param: {
        type: 'text',
        text: buildChildMessage('Audit the provider bridge'),
      },
    })

    expect(element).not.toBeNull()
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
