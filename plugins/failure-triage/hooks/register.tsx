import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import type { Cluster, Report } from '../types'

const PANE = 'failure-triage'
const TITLE = 'Failure triage'
const WATCH_MS = 3000
const WATCH_GIVE_UP_MS = 4 * 60 * 60 * 1000 // background runs longer than 4h are not followed

const report = atom({ plugin: 'failure-triage', key: 'report' } as const, null, { shape: 'report-1' })
const lastError = atom({ plugin: 'failure-triage', key: 'error' } as const, null, { shape: 'error-1' })

type Watch = { path: string; cwd: string; since: number }
type Options = { playwrightReport?: string; autoContext?: boolean }

// ------------------------------------------------------------ command parsing
const ROBOT_RX = /(^|[\s;&|(])(robot|pabot)(\s|$)|python[\w.]*\s+-m\s+robot\b/
const PW_RX = /playwright\s+test\b/

function tokens(cmd: string): string[] {
  const out: string[] = []
  const rx = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(cmd)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

function isAbs(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
}

function join(base: string, p: string): string {
  if (isAbs(p)) return p
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  const clean = p.replace(/^\.[\\/]/, '')
  return clean === '.' || clean === '' ? base : `${base.replace(/[\\/]+$/, '')}${sep}${clean}`
}

/** `cd sub && robot ...`: the directory robot actually runs in. */
function runDir(cmd: string, cwd: string): string {
  const m = /(?:^|[;&]\s*)cd\s+("([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)[^;&]*?(robot|pabot|playwright)/.exec(cmd)
  const dir = m ? (m[2] ?? m[3] ?? m[4]) : undefined
  return dir ? join(cwd, dir) : cwd
}

/** Where robot writes output.xml for this command, or null for `-o NONE`. */
function robotOutput(cmd: string, cwd: string): string | null {
  const t = tokens(cmd)
  let outdir = '.'
  let output = 'output.xml'
  for (let i = 0; i < t.length; i++) {
    const a = t[i] ?? ''
    const next = t[i + 1] ?? ''
    if (a === '-d' || a === '--outputdir') outdir = next
    else if (a.startsWith('--outputdir=')) outdir = a.slice(12)
    else if (a === '-o' || a === '--output') output = next
    else if (a.startsWith('--output=')) output = a.slice(9)
  }
  if (output.toUpperCase() === 'NONE') return null
  if (!/\.xml$/i.test(output)) output += '.xml'
  const base = runDir(cmd, cwd)
  return isAbs(output) ? output : join(join(base, outdir), output)
}

function playwrightCandidates(cmd: string, cwd: string, configured: string | undefined): string[] {
  const base = runDir(cmd, cwd)
  if (configured && configured !== 'auto') return [join(base, configured)]
  return ['playwright-report/results.json', 'test-results/results.json', 'results.json', 'report.json']
    .map(p => join(base, p))
}

// ------------------------------------------------------------ running the parser
async function findPython($: EngineInterface): Promise<string[] | null> {
  for (const cand of [['python3'], ['python'], ['py', '-3']]) {
    try {
      const r = await $.process.run([...cand, '--version'], { timeoutMs: 10000 })
      if (r.exitCode === 0) return cand
    } catch {
      // not on PATH; try the next one
    }
  }
  return null
}

async function triage($: EngineInterface, path: string): Promise<Report | string> {
  const py = await findPython($)
  if (!py) return 'Python was not found on PATH (tried python3, python, py -3).'
  const script = `${$.plugin.root}/scripts/triage.py`
  const r = await $.process.run([...py, '-I', script, path], { timeoutMs: 120000 })
  try {
    const parsed = JSON.parse(r.stdout) as Report & { error?: string }
    if (parsed.error) return parsed.error
    return { ...parsed, at: new Date().toLocaleTimeString() }
  } catch {
    return `triage.py failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).slice(0, 300)}`
  }
}

function summary(r: Report): string {
  if (r.failed === 0) return `All ${r.total} tests passed (${r.source}).`
  const lines = [
    `Failure triage for ${r.source}: ${r.failed} of ${r.total} tests failed, ${r.clusters.length} distinct cause(s).`,
  ]
  r.clusters.slice(0, 10).forEach((c, i) => {
    const where = c.keyword ? ` [${c.keyword}]` : ''
    const shown = c.tests.slice(0, 5).join('; ')
    const more = c.count > 5 ? ` (+${c.count - 5} more)` : ''
    lines.push(`${i + 1}. ${c.count}x${where} ${c.message || c.signature}\n   tests: ${shown}${more}`)
  })
  if (r.clusters.length > 10) lines.push(`…and ${r.clusters.length - 10} smaller groups.`)
  lines.push('Investigate one representative test per group before changing anything.')
  return lines.join('\n')
}

async function publish($: EngineInterface, r: Report | string, announce: boolean): Promise<void> {
  if (typeof r === 'string') {
    await update($, lastError, () => r)
    return
  }
  await update($, lastError, () => null)
  await update($, report, () => r)
  if (r.failed > 0) {
    void $.ui.open({ id: PANE, title: TITLE })
    if (announce) $.ui.toast(`${r.failed} failures → ${r.clusters.length} cause(s)`)
  }
}

async function newest($: EngineInterface, paths: string[], since: number): Promise<string | null> {
  for (const p of paths) {
    try {
      if ((await $.fs.exists(p)) && (await $.fs.stat(p)).mtimeMs >= since) return p
    } catch {
      // unreadable; skip
    }
  }
  return null
}

function rerunCommand(r: Report, c: Cluster): string {
  if (r.kind === 'robot') {
    return 'robot ' + c.tests.map(t => `--test "${t.split('.').slice(-1)[0]}"`).join(' ') + ' <suite-path>'
  }
  return 'npx playwright test -g "' + c.tests.map(t => (t.split(' › ').pop() ?? t).replace(/"/g, '\\"')).join('|') + '"'
}

// ------------------------------------------------------------ hooks
export const register: Register = (on, options) => {
  const opts = (options ?? {}) as Options
  let watches: Watch[] = []

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'triage', description: 'Show the failure-triage pane (optionally: /triage <report path>)' })
    await $.tool.register({
      name: 'triage_failures',
      description:
        'Group the failures in a Robot Framework output.xml or a Playwright JSON report by root cause ' +
        '(normalised error message + failing keyword). Use after a test run, before investigating failures one by one. ' +
        'Returns the groups with their tests; also shows them to the user in a pane.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path to output.xml or the Playwright JSON report' } },
        required: ['path'],
      },
    })

    $.clock.every(WATCH_MS, async () => {
      if (watches.length === 0) return
      const keep: Watch[] = []
      for (const w of watches) {
        if (Date.now() - w.since > WATCH_GIVE_UP_MS) continue
        const found = await newest($, [w.path], w.since)
        if (!found) { keep.push(w); continue }
        const r = await triage($, found)
        if (typeof r === 'string' && /still being written|could not parse/.test(r)) { keep.push(w); continue }
        await publish($, r, true)
      }
      watches = keep
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__failure-triage__triage_failures' }, async ($, e) => {
    const input = e as unknown as { path?: string }
    if (!input.path) return { deny: 'path is required' }
    const path = join(await $.session.cwd(), input.path)
    const r = await triage($, path)
    await publish($, r, false)
    return { result: typeof r === 'string' ? `Could not triage ${path}: ${r}` : summary(r) }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cmd = e.command
    const isRobot = ROBOT_RX.test(cmd)
    const isPw = PW_RX.test(cmd)
    if (!isRobot && !isPw) return next(e)

    const cwd = await $.session.cwd()
    const started = Date.now()
    const candidates = isRobot
      ? [robotOutput(cmd, cwd)].filter((p): p is string => p !== null)
      : playwrightCandidates(cmd, cwd, opts.playwrightReport)
    if (candidates.length === 0) return next(e)

    if (e.run_in_background) {
      const ran = await next(e)
      watches = [...watches, ...candidates.map(path => ({ path, cwd, since: started }))]
      return ran
    }

    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const found = await newest($, candidates, started)
    if (!found) return ran
    const r = await triage($, found)
    await publish($, r, false)
    if (typeof r === 'string' || r.failed === 0 || opts.autoContext === false) return ran
    return { ...ran, context: [...(ran.context ?? []), summary(r)] }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'triage' }, async ($, e) => {
    const arg = (e.args ?? '').trim()
    if (arg) {
      const r = await triage($, join(await $.session.cwd(), arg))
      await publish($, r, false)
      await $.ui.open({ id: PANE, title: TITLE })
      return { text: typeof r === 'string' ? `Triage failed: ${r}` : summary(r) }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Failure triage pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, report)
    const err = await read($, lastError)

    if (!r) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No test report triaged yet.</Text>
          <Text dimColor>Runs Claude starts are triaged automatically; or /triage path/to/output.xml</Text>
          {err && <Text color="yellow">{err}</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold color={r.failed ? 'red' : 'green'}>
          {r.failed ? `${r.failed} of ${r.total} failed → ${r.clusters.length} cause(s)` : `All ${r.total} passed`}
        </Text>
        <Text dimColor>{r.source} · {r.at}</Text>
        {err && <Text color="yellow">Last attempt: {err}</Text>}
        {r.clusters.map((c, i) => (
          <Box key={`c${i}`} flexDirection="column" marginTop={1}>
            <Text bold>{c.count}× {c.message || c.signature}</Text>
            {c.keyword !== '' && <Text dimColor>at {c.keyword}</Text>}
            {c.tests.slice(0, 4).map(t => <Text>  · {t}</Text>)}
            {c.count > 4 && <Text dimColor>  +{c.count - 4} more</Text>}
            <Button key={`rerun${i}`} label="Copy rerun command" dimColor
              onPress={() => { void $.ui.copy({ text: rerunCommand(r, c), surface: e.surface }) }} />
          </Box>
        ))}
      </Box>
    )
  })
}
