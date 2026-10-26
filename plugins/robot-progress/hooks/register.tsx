import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import type { Progress, View } from '../types'

const PANE = 'robot-progress'
const TITLE = 'Robot run'
const POLL_MS = 1000
// The listener heartbeats every second; no write for this long while
// "running" means the robot process died (killed, crashed, timed out).
const STALE_MS = 6000

const view = atom({ plugin: 'robot-progress', key: 'view' } as const,
  { progress: null, mtimeMs: 0, isStale: false }, { shape: 'view-1' })

function fmt(seconds: number | null | undefined): string {
  if (seconds == null) return '-'
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  const ss = String(r).padStart(2, '0')
  return h ? `${h}h${mm}m${ss}s` : `${mm}m${ss}s`
}

function bar(percent: number, width: number): string {
  const w = Math.max(10, Math.min(60, width))
  const filled = Math.round((percent / 100) * w)
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}

/** Pass rate over tests that ran (skips excluded), floored so a single failure never shows 100%. */
function passRate(p: Progress): number {
  const ran = p.done - p.skipped
  return ran > 0 ? Math.floor((100 * p.passed) / ran) : 0
}

function statusLine(p: Progress, isStale: boolean): string {
  const head = isStale ? 'Robot STALLED' : p.state === 'finished' ? 'Robot done' : 'Robot'
  return `${head} ${p.done}/${p.total} · ${p.passed} passed, ${p.failed} failed` +
    (p.skipped ? `, ${p.skipped} skipped` : '') +
    (p.done - p.skipped > 0 ? ` (${passRate(p)}% pass)` : '') +
    (p.state === 'running' && !isStale && p.eta_s != null ? ` · ETA ${fmt(p.eta_s)}` : '')
}

function paths($: EngineInterface) {
  return {
    listener: `${$.plugin.root}/listener/ProgressListener.py`,
    progress: `${$.plugin.root}/run/progress.json`,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { listener, progress } = paths($)

    // Inject the listener into every robot run this session starts, including
    // runs launched via shell scripts / repeatrun. ROBOT_OPTIONS is split on
    // spaces by Robot Framework, so a path containing a space cannot go there.
    if (listener.includes(' ') || progress.includes(' ')) {
      $.ui.toast('robot-progress: plugin path contains a space; add the listener to robot commands manually')
    } else {
      const existing = (await $.env.get('ROBOT_OPTIONS')) ?? ''
      if (!existing.includes('ProgressListener.py')) {
        // ';' separates listener args on every OS (Windows drive letters included)
        const opt = `--listener ${listener};${progress}`
        await $.env.set('ROBOT_OPTIONS', existing ? `${existing} ${opt}` : opt)
      }
    }

    await $.command.register({
      name: 'robot-progress',
      description: 'Show the live Robot Framework run pane',
    })

    let lastPid = -1
    let lastState = ''
    $.clock.every(POLL_MS, async () => {
      if (!(await $.fs.exists(progress))) return
      const stat = await $.fs.stat(progress)
      const before = await read($, view)
      let p = before.progress
      if (stat.mtimeMs !== before.mtimeMs) {
        try {
          p = JSON.parse(await $.fs.read(progress)) as Progress
        } catch {
          return // mid-replace; next tick
        }
      }
      if (!p) return
      const isStale = p.state !== 'finished' && Date.now() - stat.mtimeMs > STALE_MS
      if (stat.mtimeMs === before.mtimeMs && isStale === before.isStale) return

      await update($, view, () => ({ progress: p, mtimeMs: stat.mtimeMs, isStale }))
      $.ui.status(statusLine(p, isStale))

      // A new run (new process) started: bring the pane up.
      if (p.state !== 'finished' && p.pid !== lastPid) {
        void $.ui.open({ id: PANE, title: TITLE })
      }
      if (p.state === 'finished' && lastState && lastState !== 'finished') {
        $.ui.toast(`Robot run finished: ${p.passed} passed, ${p.failed} failed, ${p.skipped} skipped`)
      }
      if (isStale && !before.isStale) {
        $.ui.toast('Robot run stopped reporting — process may have been killed')
      }
      lastPid = p.pid
      lastState = isStale ? 'stale' : p.state
    })

    return next(e)
  })

  on('command.run', { command: 'robot-progress' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Robot run pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { progress: p, isStale } = await read($, view)
    const cols = (e.props.bodyColumns ?? 40) - 8

    if (!p) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No Robot run yet this session.</Text>
          <Text dimColor>Any `robot` run started from here reports automatically.</Text>
        </Box>
      )
    }

    const stateText = isStale ? 'STALLED (no update)' : p.state === 'finished' ? 'Finished' : 'Running'
    const stateColor = isStale ? 'yellow' : p.state === 'finished' ? (p.failed ? 'red' : 'green') : 'cyan'
    const failures = [...p.recent_failures].reverse().slice(0, 8)

    return (
      <Box flexDirection="column">
        <Text bold color={stateColor}>{stateText}  ·  {p.suite ?? ''}</Text>
        <Text>{bar(p.percent, cols)} {p.percent}%</Text>
        <Text>
          {p.done}/{p.total}   <Text color="green">{p.passed} passed</Text>   <Text color="red">{p.failed} failed</Text>   <Text dimColor>{p.skipped} skipped</Text>{p.done - p.skipped > 0 ? `   ${passRate(p)}% pass` : ''}
        </Text>
        <Text dimColor>
          elapsed {fmt(p.elapsed_s)}{p.state === 'running' && !isStale ? `  ·  ETA ~${fmt(p.eta_s)}` : ''}  ·  updated {p.updated_at}
        </Text>
        {p.current_test && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Now ({fmt(p.current_test_elapsed_s)})</Text>
            <Text>{p.current_test}</Text>
            {p.current_keyword && <Text dimColor>↳ {p.current_keyword}</Text>}
          </Box>
        )}
        {failures.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="red">Failures ({p.failed})</Text>
            {failures.map(f => (
              <Box flexDirection="column">
                <Text>- {f.test}</Text>
                <Text dimColor>   {(f.message.split('\n')[0] ?? '').slice(0, Math.max(20, cols))}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
