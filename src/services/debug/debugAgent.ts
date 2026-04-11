/**
 * FreeClaude v2 — Debug Agent
 *
 * Evidence-based debugging: generates hypotheses, instruments code
 * with NDJSON logs, analyzes results to confirm/reject hypotheses.
 *
 * Ported from: github.com/millionco/debug-agent
 */

import { execSync, exec, type ExecOptions } from 'node:child_process'
import { existsSync, mkdirSync, appendFileSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Hypothesis {
  id: string
  description: string
  status: 'pending' | 'confirmed' | 'rejected'
  evidence?: string
  confidence: number // 0-1
}

export interface DebugSession {
  id: string
  bugDescription: string
  hypotheses: Hypothesis[]
  logFile: string
  startTime: string
  endTime?: string
  status: 'active' | 'resolved' | 'unresolved'
}

export interface InstrumentationPoint {
  file: string
  line: number
  variable: string
  logFormat: string
}

// ---------------------------------------------------------------------------
// DebugAgent
// ---------------------------------------------------------------------------

export class DebugAgent {
  private session: DebugSession | null = null

  /**
   * Start a debug session for a bug.
   */
  async startSession(bugDescription: string): Promise<DebugSession> {
    const sessionId = randomUUID().slice(0, 8)
    const logFile = join(tmpdir(), `freeclaude-debug-${sessionId}.ndjson`)

    this.session = {
      id: sessionId,
      bugDescription,
      hypotheses: [],
      logFile,
      startTime: new Date().toISOString(),
      status: 'active',
    }

    // Generate hypotheses using the current LLM provider
    const hypotheses = await this.generateHypotheses(bugDescription)
    this.session.hypotheses = hypotheses

    this.log(`session_start`, { sessionId, bugDescription, hypothesisCount: hypotheses.length })
    for (const h of hypotheses) {
      this.log(`hypothesis`, { id: h.id, description: h.description, confidence: h.confidence })
    }

    return this.session
  }

  /**
   * Generate hypotheses for a bug.
   * In a full implementation, this would call the LLM.
   * For now, generates structural hypotheses based on the description.
   */
  private async generateHypotheses(description: string): Promise<Hypothesis[]> {
    // Extract keywords from description for hypothesis generation
    const keywords = description.toLowerCase()

    const hypotheses: Hypothesis[] = []

    // Common bug patterns
    if (keywords.includes('error') || keywords.includes('ошибка')) {
      hypotheses.push({
        id: 'h1',
        description: 'Unhandled exception in the call stack — error is thrown but not caught',
        status: 'pending',
        confidence: 0.8,
      })
    }

    if (keywords.includes('null') || keywords.includes('undefined') || keywords.includes('nil')) {
      hypotheses.push({
        id: 'h2',
        description: 'Null/undefined reference — variable is not initialized or function returns null',
        status: 'pending',
        confidence: 0.75,
      })
    }

    if (keywords.includes('race') || keywords.includes('concurrent') || keywords.includes('async')) {
      hypotheses.push({
        id: 'h3',
        description: 'Race condition — async operations complete in unexpected order',
        status: 'pending',
        confidence: 0.7,
      })
    }

    if (keywords.includes('timeout') || keywords.includes('hang') || keywords.includes('завис')) {
      hypotheses.push({
        id: 'h4',
        description: 'Resource leak or infinite loop — connections/file handles not released',
        status: 'pending',
        confidence: 0.65,
      })
    }

    if (keywords.includes('wrong') || keywords.includes('incorrect') || keywords.includes('неправильн')) {
      hypotheses.push({
        id: 'h5',
        description: 'Logic error — calculation or condition produces wrong result',
        status: 'pending',
        confidence: 0.6,
      })
    }

    // Always add a generic fallback
    if (hypotheses.length === 0) {
      hypotheses.push({
        id: 'h1',
        description: 'Input validation issue — unexpected input causes failure',
        status: 'pending',
        confidence: 0.5,
      })
      hypotheses.push({
        id: 'h2',
        description: 'State management issue — previous state corrupts current operation',
        status: 'pending',
        confidence: 0.4,
      })
    }

    return hypotheses
  }

  /**
   * Generate instrumentation code for a hypothesis.
   */
  generateInstrumentation(
    filePath: string,
    hypothesis: Hypothesis,
  ): InstrumentationPoint[] {
    const points: InstrumentationPoint[] = []

    // Read file to find candidate lines
    if (!existsSync(filePath)) return points

    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    // Simple heuristic: instrument function entries, returns, and error handlers
    lines.forEach((line, idx) => {
      const lineNum = idx + 1
      const trimmed = line.trim()

      // Function declarations
      if (/^(export\s+)?(async\s+)?function\s+/.test(trimmed)) {
        const match = trimmed.match(/function\s+(\w+)/)
        if (match) {
          points.push({
            file: filePath,
            line: lineNum,
            variable: match[1],
            logFormat: JSON.stringify({
              event: 'function_enter',
              function: match[1],
              hypothesis: hypothesis.id,
              line: lineNum,
            }),
          })
        }
      }

      // Error handling
      if (/catch\s*\(/.test(trimmed) || /\.catch\s*\(/.test(trimmed)) {
        points.push({
          file: filePath,
          line: lineNum,
          variable: 'error',
          logFormat: JSON.stringify({
            event: 'error_caught',
            hypothesis: hypothesis.id,
            line: lineNum,
            error: '${error?.message || error}',
          }),
        })
      }

      // Return statements
      if (/^(\s*)return\s+/.test(trimmed) && !trimmed.includes('//')) {
        points.push({
          file: filePath,
          line: lineNum,
          variable: 'return_value',
          logFormat: JSON.stringify({
            event: 'return',
            hypothesis: hypothesis.id,
            line: lineNum,
            value: '${returnValue}',
          }),
        })
      }
    })

    return points.slice(0, 20) // Limit instrumentation points
  }

  /**
   * Analyze logs to evaluate hypotheses.
   */
  analyzeLogs(): { confirmed: Hypothesis[]; rejected: Hypothesis[]; summary: string } {
    if (!this.session || !existsSync(this.session.logFile)) {
      return { confirmed: [], rejected: [], summary: 'No logs to analyze' }
    }

    const logs = readFileSync(this.session.logFile, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(Boolean) as Array<Record<string, unknown>>

    const confirmed: Hypothesis[] = []
    const rejected: Hypothesis[] = []

    for (const hypothesis of this.session.hypotheses) {
      if (hypothesis.status !== 'pending') continue

      // Check for evidence related to this hypothesis
      const evidence = logs.filter(
        log => log.hypothesis === hypothesis.id || log.event === 'error_caught',
      )

      if (evidence.length > 0) {
        hypothesis.status = 'confirmed'
        hypothesis.evidence = evidence.map(e => JSON.stringify(e)).join('\n')
        confirmed.push(hypothesis)
      } else {
        hypothesis.status = 'rejected'
        rejected.push(hypothesis)
      }
    }

    const summary = [
      `Debug session ${this.session.id}: ${this.session.bugDescription}`,
      `Hypotheses: ${confirmed.length} confirmed, ${rejected.length} rejected`,
      ...confirmed.map(h => `  ✅ ${h.description} (confidence: ${h.confidence})`),
      ...rejected.map(h => `  ❌ ${h.description}`),
    ].join('\n')

    return { confirmed, rejected, summary }
  }

  /**
   * End the debug session and clean up.
   */
  endSession(status: 'resolved' | 'unresolved' = 'unresolved'): DebugSession {
    if (!this.session) throw new Error('No active session')

    this.session.status = status
    this.session.endTime = new Date().toISOString()

    const analysis = this.analyzeLogs()
    this.log('session_end', {
      sessionId: this.session.id,
      status,
      summary: analysis.summary,
    })

    const session = { ...this.session }
    this.session = null
    return session
  }

  /**
   * Get the current session.
   */
  getSession(): DebugSession | null {
    return this.session
  }

  /**
   * Get session summary for display.
   */
  getSummary(): string {
    if (!this.session) return 'No active debug session'

    const h = this.session.hypotheses
    return [
      `🐛 Debug Session: ${this.session.id}`,
      `Description: ${this.session.bugDescription}`,
      `Status: ${this.session.status}`,
      `Hypotheses:`,
      ...h.map(hp =>
        `  ${hp.status === 'confirmed' ? '✅' : hp.status === 'rejected' ? '❌' : '⏳'} ${hp.description} (${(hp.confidence * 100).toFixed(0)}%)`,
      ),
      `Log file: ${this.session.logFile}`,
    ].join('\n')
  }

  // ---- Private ----

  private log(event: string, data: Record<string, unknown>): void {
    if (!this.session) return

    try {
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...data,
      })
      appendFileSync(this.session.logFile, entry + '\n', 'utf-8')
    } catch {
      // Non-critical
    }
  }
}

/**
 * Quick debug helper — one-shot analysis.
 */
export async function quickDebug(
  bugDescription: string,
  targetFile?: string,
): Promise<string> {
  const agent = new DebugAgent()
  const session = await agent.startSession(bugDescription)

  let summary = agent.getSummary() + '\n'

  if (targetFile) {
    // Generate instrumentation for the first hypothesis
    const h = session.hypotheses[0]
    if (h) {
      const points = agent.generateInstrumentation(targetFile, h)
      if (points.length > 0) {
        summary += `\n📋 Suggested instrumentation points (${targetFile}):\n`
        for (const p of points.slice(0, 5)) {
          summary += `  Line ${p.line}: ${p.variable}\n`
        }
      }
    }
  }

  agent.endSession('unresolved')
  return summary
}
