import type { Register, EngineInterface } from 'claude-code'

type Options = { tagPattern?: string; mode?: string }
type Untagged = { file: string; line: number; test: string }
type Result = { mode: string; checked: number; untagged: Untagged[]; errors: string[] }

const DEFAULT_PATTERN = '^(REQ|SRS|SSRS|SRD|HAZ|SAF)[-_:.]?\\S*\\d'
const COMMIT_RX = /(^|[\s;&|(])git\s+(-C\s+("[^"]*"|'[^']*'|\S+)\s+)?commit\b/
const MAX_LISTED = 25

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
  return isAbs(p) ? p : `${base.replace(/[\\/]+$/, '')}/${p.replace(/^\.[\\/]/, '')}`
}

/** The repo directory the commit runs in: `cd x && git commit`, `git -C x commit`. */
function commitDir(cmd: string, cwd: string): string {
  const c = /git\s+-C\s+("([^"]+)"|'([^']+)'|(\S+))\s+commit\b/.exec(cmd)
  if (c) return join(cwd, c[2] ?? c[3] ?? c[4] ?? '.')
  const d = /(?:^|[;&]\s*)cd\s+("([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)[^;&]*?git\s/.exec(cmd)
  return d ? join(cwd, d[2] ?? d[3] ?? d[4] ?? '.') : cwd
}

/** `git commit -a` / `-am` / `--all`: commits the working tree, not just the index. */
function commitsAll(cmd: string): boolean {
  const t = tokens(cmd)
  const at = t.findIndex(x => x === 'commit')
  return t.slice(at + 1).some(x => x === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(x))
}

async function findPython($: EngineInterface): Promise<string[] | null> {
  for (const cand of [['python3'], ['python'], ['py', '-3']]) {
    try {
      const r = await $.process.run([...cand, '--version'], { timeoutMs: 10000 })
      if (r.exitCode === 0) return cand
    } catch {
      // try the next one
    }
  }
  return null
}

async function check($: EngineInterface, cwd: string, flag: string, pattern: string): Promise<Result | string> {
  const py = await findPython($)
  if (!py) return 'Python was not found on PATH (tried python3, python, py -3).'
  const r = await $.process.run([...py, '-I', `${$.plugin.root}/scripts/trace.py`, flag, '--pattern', pattern],
    { cwd, timeoutMs: 120000 })
  try {
    const parsed = JSON.parse(r.stdout) as Result & { error?: string }
    return parsed.error ? parsed.error : parsed
  } catch {
    return `trace.py failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).slice(0, 300)}`
  }
}

function listing(u: Untagged[]): string {
  const shown = u.slice(0, MAX_LISTED).map(x => `  ${x.file}:${x.line}  ${x.test}`)
  if (u.length > MAX_LISTED) shown.push(`  …and ${u.length - MAX_LISTED} more`)
  return shown.join('\n')
}

const HOW_TO_FIX =
  'Add the requirement tag to each test (Robot: [Tags]    REQ-…; Playwright: { tag: \'@REQ-…\' }). ' +
  'Do NOT invent or guess requirement IDs: ask the user which requirement each test verifies. ' +
  'If a test genuinely verifies no requirement, tell the user so they can decide.'

async function audit($: EngineInterface, pattern: string): Promise<string> {
  const r = await check($, await $.session.cwd(), '--repo', pattern)
  if (typeof r === 'string') return `Traceability audit could not run: ${r}`
  if (r.untagged.length === 0) return `All ${r.checked} tests carry a requirement tag.`
  const pct = Math.round((100 * (r.checked - r.untagged.length)) / Math.max(1, r.checked))
  return `${r.untagged.length} of ${r.checked} tests have no requirement tag (${pct}% tagged):\n${listing(r.untagged)}`
}

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as Options
  const pattern = opts.tagPattern && opts.tagPattern.trim() ? opts.tagPattern : DEFAULT_PATTERN
  const isBlocking = opts.mode !== 'warn'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'trace-audit', description: 'List every test in this repo with no requirement tag' })
    await $.tool.register({
      name: 'trace_audit',
      description:
        'List every Robot Framework / Playwright test in the current git repository that has no requirement tag ' +
        `(tags matching /${pattern}/i). Use when asked about requirement coverage or traceability gaps.`,
      inputSchema: { type: 'object', properties: {} },
    })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cmd = e.command
    if (!COMMIT_RX.test(cmd)) return next(e)

    const r = await check($, commitDir(cmd, await $.session.cwd()), commitsAll(cmd) ? '--commit-all' : '--staged', pattern)
    if (typeof r === 'string') {
      // A broken check must not silently pass a safety-relevant commit.
      if (isBlocking && !/not a git repository/.test(r)) {
        return { deny: `traceability-check could not run, so the commit was not made: ${r}\nTell the user.` }
      }
      return next(e)
    }
    if (r.untagged.length === 0) {
      $.ui.status(r.checked ? `trace: ${r.checked} changed test(s) tagged` : undefined)
      return next(e)
    }

    const head = `${r.untagged.length} of ${r.checked} changed test(s) have no requirement tag (pattern /${pattern}/i):\n${listing(r.untagged)}`
    if (isBlocking) {
      $.ui.toast(`Commit blocked: ${r.untagged.length} test(s) without requirement tag`)
      return { deny: `traceability-check: commit refused.\n${head}\n${HOW_TO_FIX}` }
    }
    $.ui.toast(`${r.untagged.length} committed test(s) lack a requirement tag`)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), `traceability-check (warning): ${head}\n${HOW_TO_FIX}`] }
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : isBlocking
        ? { deny: 'traceability-check failed, so the commit was not made. Tell the user.' }
        : next(e),
  )

  on('tool.call', { tool: 'mcp__traceability-check__trace_audit' }, async $ => ({ result: await audit($, pattern) }))
  on('command.run', { command: 'trace-audit' }, async $ => ({ text: await audit($, pattern) }))
}
