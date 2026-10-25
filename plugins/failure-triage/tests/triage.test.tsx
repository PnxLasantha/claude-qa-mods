import { expect, test } from 'claude-code/testing'

const REPORT = {
  source: '/proj/results/output.xml', kind: 'robot', total: 9, failed: 8,
  clusters: [
    { signature: 'Connection refused: <ip> after <n>ms', keyword: 'lib.Connect To Broker › BuiltIn.Fail',
      message: 'Connection refused: 10.0.0.11:1883 after 11ms', count: 4,
      tests: ['S.Connect A', 'S.Connect B', 'S.Connect C', 'S.Swallowed'] },
    { signature: '<n> != <n>', keyword: 'BuiltIn.Should Be Equal As Integers', message: '41 != 42', count: 2,
      tests: ['S.Value Check', 'S.Value Check 2'] },
  ],
}

type Argv = { argv: readonly string[] }

function engine(on: any, seen: { argv: string[][] }, stdout = JSON.stringify(REPORT)) {
  on('command.register', () => ({ value: { command: 'triage' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__failure-triage__triage_failures' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: Date.now() + 1000, isLink: false } }))
  on('process.run', (_: unknown, e: Argv) => {
    seen.argv.push([...e.argv])
    if (e.argv.includes('--version')) return { value: { exitCode: 0, stdout: 'Python 3.12', stderr: '' } }
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('tool.call', () => ({ result: { stdout: 'robot output', stderr: '' } }))
}

test('a failing foreground robot run gives Claude the grouped causes', async ($, on) => {
  const seen = { argv: [] as string[][] }
  engine(on, seen)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', command: 'cd suites && robot -d results mqtt.robot' })

  const triageCall = seen.argv.find(a => a.some(x => x.endsWith('triage.py')))
  expect(triageCall?.at(-1)).toBe('/proj/suites/results/output.xml')
  const ctx = (ran as { context?: readonly string[] }).context?.join('\n') ?? ''
  expect(ctx).toContain('8 of 9 tests failed, 2 distinct cause(s)')
  expect(ctx).toContain('Connect To Broker')
})

test('a passing run adds nothing to what Claude reads', async ($, on) => {
  const seen = { argv: [] as string[][] }
  engine(on, seen, JSON.stringify({ ...REPORT, failed: 0, clusters: [] }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', command: 'robot tests/' })
  expect((ran as { context?: readonly string[] }).context ?? []).toEqual([])
})

test('-o NONE and unrelated commands are left alone', async ($, on) => {
  const seen = { argv: [] as string[][] }
  engine(on, seen)
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'robot -o NONE tests/' })
  await $.tool.call({ tool: 'Bash', command: 'pip install robotframework' })
  expect(seen.argv.some(a => a.some(x => x.endsWith('triage.py')))).toBe(false)
})

test('the pane shows each cause with its tests on every surface', async ($, on) => {
  on('state.get', (_: unknown, e: { key: string }) => ({
    value: e.key === 'report'
      ? { value: { shape: 'report-1', value: { ...REPORT, at: '20:00:00' } }, version: 1 }
      : { value: { shape: 'error-1', value: null }, version: 1 },
  }))
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'failure-triage', surface, component: 'Pane', requestId: 'failure-triage',
      props: { title: 'Failure triage', isFocused: false, bodyColumns: 60, placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /8 of 9 failed → 2 cause/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /4× Connection refused/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Swallowed/ })).toBeTruthy()
    await ui.unmount()
  }
})
