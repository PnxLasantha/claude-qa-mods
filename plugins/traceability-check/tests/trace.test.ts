import { expect, test } from 'claude-code/testing'

const DIRTY = { mode: 'staged', checked: 3, errors: [],
  untagged: [{ file: 'suites/mqtt/broker.robot', line: 20, test: 'New Untagged' }] }
const CLEAN = { mode: 'staged', checked: 3, errors: [], untagged: [] }

type Call = { argv: string[]; cwd?: string }

function engine(on: any, stdout: string, calls: Call[], ran: string[]) {
  on('command.register', () => ({ value: { command: 'trace-audit' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__traceability-check__trace_audit' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('process.run', (_: unknown, e: { argv: readonly string[]; init?: { cwd?: string }; cwd?: string }) => {
    if (e.argv.includes('--version')) return { value: { exitCode: 0, stdout: 'Python 3.12', stderr: '' } }
    calls.push({ argv: [...e.argv], cwd: e.init?.cwd ?? e.cwd })
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('tool.call', (_: unknown, e: { command: string }) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '' } }
  })
}

async function start($: any) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

const deny = (r: unknown) => (r as { deny?: string }).deny ?? ''

test('blocks a commit whose changed tests have no requirement tag, and forbids inventing IDs', async ($, on) => {
  const calls: Call[] = []; const ran: string[] = []
  engine(on, JSON.stringify(DIRTY), calls, ran)
  await start($)
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "add broker tests"' })
  expect(deny(r)).toContain('New Untagged')
  expect(deny(r)).toContain('Do NOT invent')
  expect(calls[0]?.argv).toContain('--staged')
  expect(ran).toEqual([])
})

test('git commit -am checks the working tree, in the directory it runs in', async ($, on) => {
  const calls: Call[] = []; const ran: string[] = []
  engine(on, JSON.stringify(CLEAN), calls, ran)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'cd repo && git commit -am "wip"' })
  await $.tool.call({ tool: 'Bash', command: 'git -C other commit --all -m x' })
  expect(calls[0]?.argv).toContain('--commit-all')
  expect(calls[1]?.argv).toContain('--commit-all')
  expect(ran.length).toBe(2)
})

test('a clean commit and non-commit commands go through', async ($, on) => {
  const calls: Call[] = []; const ran: string[] = []
  engine(on, JSON.stringify(CLEAN), calls, ran)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m ok' })
  await $.tool.call({ tool: 'Bash', command: 'git log --oneline' })
  await $.tool.call({ tool: 'Bash', command: 'robot suites' })
  expect(ran).toEqual(['git commit -m ok', 'git log --oneline', 'robot suites'])
  expect(calls.length).toBe(1)
})

test('warn mode lets the commit through and tells Claude', { options: { mode: 'warn' } }, async ($, on) => {
  const calls: Call[] = []; const ran: string[] = []
  engine(on, JSON.stringify(DIRTY), calls, ran)
  await start($)
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(ran).toEqual(['git commit -m x'])
  expect(((r as { context?: readonly string[] }).context ?? []).join('\n')).toContain('New Untagged')
})

test('a broken check refuses the commit in block mode, but a non-repo folder is not its business', async ($, on) => {
  const calls: Call[] = []; const ran: string[] = []
  engine(on, JSON.stringify({ error: "bad tag pattern '(['" }), calls, ran)
  await start($)
  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(deny(r)).toContain('could not run')
  expect(ran).toEqual([])
})

test('a commit outside a git repository is passed through to git', async ($, on) => {
  const calls: Call[] = []; const ran: string[] = []
  engine(on, JSON.stringify({ error: 'not a git repository (fatal)' }), calls, ran)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(ran).toEqual(['git commit -m x'])
})

test('the audit command reports coverage', async ($, on) => {
  const calls: Call[] = []; const ran: string[] = []
  engine(on, JSON.stringify({ ...DIRTY, mode: 'repo', checked: 11 }), calls, ran)
  await start($)
  const r = await $.command.run({ command: 'trace-audit', args: '' })
  expect((r as { text?: string }).text ?? '').toContain('1 of 11 tests have no requirement tag (91% tagged)')
  expect(calls[0]?.argv).toContain('--repo')
})
