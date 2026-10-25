import { expect, test } from 'claude-code/testing'

const PS_IDLE = '  1 /sbin/init\n 200 /usr/bin/bash\n'
const PS_BUSY = PS_IDLE + ' 345 /usr/bin/python3 /home/l/.venv/bin/robot -d out suites/mqtt\n'

function engine(on: any, ps: string | 'fail', ran: string[]) {
  on('command.register', () => ({ value: { command: 'run-guard' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    if (ps === 'fail') throw new Error('ENOENT')
    if (e.argv[0] === 'ps') return { value: { exitCode: 0, stdout: ps, stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })
  on('tool.call', (_: unknown, e: { command: string }) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '' } }
  })
}

async function start($: any) {
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

test('a second test run is refused while one is running', async ($, on) => {
  const ran: string[] = []
  engine(on, PS_BUSY, ran)
  await start($)
  const r = await $.tool.call({ tool: 'Bash', command: 'robot -t "One" suites' })
  expect((r as { deny?: string }).deny ?? '').toContain('already in progress')
  expect(ran).toEqual([])
})

test('a test run goes ahead when nothing is running, and non-test commands are never checked', async ($, on) => {
  const ran: string[] = []
  engine(on, PS_IDLE, ran)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'robot -t "One" suites' })
  await $.tool.call({ tool: 'Bash', command: 'cd robot && ls' })
  expect(ran).toEqual(['robot -t "One" suites', 'cd robot && ls'])
})

test('deleting reports is refused; unrelated deletes are not', async ($, on) => {
  const ran: string[] = []
  engine(on, PS_IDLE, ran)
  await start($)
  for (const cmd of ['rm -rf results', 'git clean -fdx', 'find . -name "output*.xml" -delete']) {
    const r = await $.tool.call({ tool: 'Bash', command: cmd })
    expect((r as { deny?: string }).deny ?? '').toContain('test reports')
  }
  await $.tool.call({ tool: 'Bash', command: 'rm -rf node_modules' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/x && cat results/output.xml' })
  expect(ran).toEqual(['rm -rf node_modules', 'rm -rf /tmp/x && cat results/output.xml'])
})

test('protected hosts are refused, matched as whole names', { options: { protectedHosts: 'prod-broker.example.com, 10.20.0.5' } },
  async ($, on) => {
    const ran: string[] = []
    engine(on, PS_IDLE, ran)
    await start($)
    const r1 = await $.tool.call({ tool: 'Bash', command: 'mosquitto_pub -h prod-broker.example.com -t x -m y' })
    const r2 = await $.tool.call({ tool: 'Bash', command: 'robot -v HOST:10.20.0.5 suites' })
    expect((r1 as { deny?: string }).deny ?? '').toContain('protected host')
    expect((r2 as { deny?: string }).deny ?? '').toContain('protected host')
    await $.tool.call({ tool: 'Bash', command: 'ping 10.20.0.50' })
    expect(ran).toEqual(['ping 10.20.0.50'])
  })

test('when processes cannot be listed the run goes ahead (overlap check is best effort)', async ($, on) => {
  const ran: string[] = []
  engine(on, 'fail', ran)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'robot suites' })
  expect(ran).toEqual(['robot suites'])
})

test('each rule can be switched off', { options: { blockConcurrent: false, protectReports: false } }, async ($, on) => {
  const ran: string[] = []
  engine(on, PS_BUSY, ran)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'robot suites' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf results' })
  expect(ran).toEqual(['robot suites', 'rm -rf results'])
})
