import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  if (trimmed === 'help') {
    return {
      type: 'text',
      value: [
        'Usage: /heartbeat [subcommand]',
        '',
        '  (none)     — Run health check and show status',
        '  maintain   — Run health check + memory maintenance (GC + consolidation)',
        '  last       — Show last heartbeat result (no new check)',
        '',
        'Checks: provider connectivity, memory integrity,',
        'task/agent PID health, disk usage.',
      ].join('\n'),
    }
  }

  if (trimmed === 'last') {
    try {
      const { getLastHeartbeat, formatHeartbeat } = await import('../../services/heartbeat/heartbeat.js')
      const last = getLastHeartbeat()
      if (!last) {
        return { type: 'text', value: 'No previous heartbeat found. Run /heartbeat first.' }
      }
      return { type: 'text', value: formatHeartbeat(last) }
    } catch (e) {
      return { type: 'text', value: `Error: ${e}` }
    }
  }

  try {
    const { runHeartbeat, formatHeartbeat, runMaintenance } = await import('../../services/heartbeat/heartbeat.js')
    const status = await runHeartbeat()
    let output = formatHeartbeat(status)

    if (trimmed === 'maintain' || trimmed === 'maintenance') {
      const maint = await runMaintenance()
      const lines = [
        '',
        '   🧹 Maintenance:',
        `     GC: removed ${maint.gc.removed.length}, kept ${maint.gc.kept}`,
        `     Consolidation: merged ${maint.consolidation.merged}`,
      ]
      if (maint.gc.removed.length > 0) {
        lines.push(`     GC removed: ${maint.gc.removed.join(', ')}`)
      }
      if (maint.consolidation.removed.length > 0) {
        lines.push(`     Merged: ${maint.consolidation.removed.join(', ')}`)
      }
      output += lines.join('\n')
    }

    return { type: 'text', value: output }
  } catch (e) {
    return { type: 'text', value: `Heartbeat failed: ${e}` }
  }
}
