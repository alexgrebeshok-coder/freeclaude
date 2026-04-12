import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { GIT_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
import {
  autoCommitFiles,
  diffSinceLastCommit,
  generateRepoMap,
  getGitContextSnapshot,
  undoRecentCommits,
} from './gitToolUtils.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z
      .enum(['status', 'diff', 'undo', 'repo_map', 'auto_commit'])
      .describe('Git operation to perform'),
    count: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Number of commits to undo when operation is "undo"'),
    file_paths: z
      .array(z.string())
      .optional()
      .describe(
        'Absolute or repo-relative paths to auto-commit when operation is "auto_commit"',
      ),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe('Maximum directory depth for repo_map'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    operation: z.string(),
    output: z.string(),
    commit_sha: z.string().optional(),
    commit_message: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

type Input = z.infer<InputSchema>
export type Output = z.infer<OutputSchema>

export const GitTool = buildTool({
  name: GIT_TOOL_NAME,
  searchHint: 'git status, diff, undo, repo map, auto commit',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Git'
  },
  isConcurrencySafe(input: Input) {
    return input.operation === 'status' || input.operation === 'diff' || input.operation === 'repo_map'
  },
  isReadOnly(input: Input) {
    return input.operation === 'status' || input.operation === 'diff' || input.operation === 'repo_map'
  },
  toAutoClassifierInput(input: Input) {
    return input.operation
  },
  renderToolUseMessage(input: Partial<Input>) {
    return `Git: ${input.operation ?? 'operation'}`
  },
  renderToolResultMessage(output: Output) {
    return output.output
  },
  mapToolResultToToolResultBlockParam(output: Output, toolUseID) {
    const suffix =
      output.commit_sha && output.commit_message
        ? `\nCommit: ${output.commit_sha} ${output.commit_message}`
        : output.commit_sha
          ? `\nCommit: ${output.commit_sha}`
          : ''
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${output.output}${suffix}`,
      ...(output.success ? {} : { is_error: true }),
    }
  },
  async call(input: Input) {
    switch (input.operation) {
      case 'status': {
        const snapshot = await getGitContextSnapshot()
        return {
          data: {
            success: snapshot !== null,
            operation: input.operation,
            output:
              snapshot === null
                ? 'Not inside a git repository.'
                : [
                    `Current branch: ${snapshot.branch}`,
                    `Uncommitted changes:\n${snapshot.status}`,
                    `Recent commits:\n${snapshot.recentCommits}`,
                  ].join('\n\n'),
          },
        }
      }

      case 'diff': {
        const result = await diffSinceLastCommit()
        return {
          data: {
            success: result.success,
            operation: input.operation,
            output: result.output,
          },
        }
      }

      case 'undo': {
        const result = await undoRecentCommits(input.count ?? 1)
        return {
          data: {
            success: result.success,
            operation: input.operation,
            output: result.output,
          },
        }
      }

      case 'repo_map': {
        const result = await generateRepoMap({ maxDepth: input.max_depth })
        return {
          data: {
            success: result.success,
            operation: input.operation,
            output: result.output,
          },
        }
      }

      case 'auto_commit': {
        const result = await autoCommitFiles(input.file_paths ?? [])
        return {
          data: {
            success: result.committed,
            operation: input.operation,
            output:
              result.committed
                ? `Auto-committed ${result.sha ? `as ${result.sha}` : 'changes'}`
                : result.reason ?? 'Auto-commit did not create a commit.',
            ...(result.sha ? { commit_sha: result.sha } : {}),
            ...(result.message ? { commit_message: result.message } : {}),
          },
        }
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
