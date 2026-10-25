import type { Register, EngineInterface } from 'claude-code'

type Options = { protectedHosts?: string; blockConcurrent?: boolean; protectReports?: boolean }

// A test run typed as a command (cd/pushd arguments are stripped first: `cd robot` is not a run).
const CMD_RUN_RX =
  /(^|[\s;&|(])(robot|pabot)(\.exe)?(\s|$)|python[\w.]*(\.exe)?\s+-m\s+(robot|pabot)(\s|$)|playwright\s+test\b/i
// A test run as a process command line (interpreters show the script's full path).
const PROC_RUN_RX =
  /(^|[\s;&|(\\/])(robot|pabot)(\.exe)?(\s|$)|python[\w.]*(\.exe)?\s+-m\s+(robot|pabot)(\s|$)|playwright[\\/\w@.-]*\s+test\b/i

// Commands that delete things.
const DELETE_RX =
  /(^|[\s;&|(])(rm|rmdir|del|erase|rd|unlink|shred|Remove-Item|ri)(\s|$)|find\b[^;&|]*\s-delete\b|shutil\.rmtree|os\.remove/i
// git clean -x / -X also wipes ignored folders, i.e. results.
const GIT_CLEAN_X_RX = /git\s+clean\b[^;&|]*\s-\w*[xX]/

// Test evidence: Robot outputs, xunit, Playwright and Allure folders.
const REPORT_RX =
  /(^|[\s/\\'"=])(output[\w.*-]*\.xml|log[\w.*-]*\.html|report[\w.*-]*\.html|xunit[\w.*-]*\.xml|results?|test-results|playwright-report|allure-results|allure-report|reports?)([\s/\\'"*]|$)/i

function stripCd(cmd: string): string {
  return cmd.replace(/\b(cd|pushd)\s+("[^"]*"|'[^']*'|\S+)/g, '')
}

function isTestRun(cmd: string): boolean {
  return CMD_RUN_RX.test(stripCd(cmd))
}

/** Delete and report path in the same segment of a command chain. */
function deletesReports(cmd: string): boolean {
  if (GIT_CLEAN_X_RX.test(cmd)) return true
  return cmd.split(/&&|\|\||;|\|/).some(seg => DELETE_RX.test(seg) && REPORT_RX.test(seg))
}

function hostsOf(opts: Options): string[] {
  return (opts.protectedHosts ?? '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(h => h.length > 0)
}

function mentionsHost(cmd: string, host: string): boolean {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w.-])${escaped}($|[^\\w.-])`, 'i').test(cmd)
}

/** Running test processes on this machine as "pid cmdline", or null when processes can't be listed. */
async function runningTests($: EngineInterface): Promise<string[] | null> {
  let lines: string[] | null = null
  try {
    const r = await $.process.run(['ps', '-eo', 'pid=,args='], { timeoutMs: 10000 })
    if (r.exitCode === 0) lines = r.stdout.split('\n')
  } catch {
    // no ps: Windows
  }
  if (lines === null) {
    try {
      const r = await $.process.run(
        ['powershell', '-NoProfile', '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }'],
        { timeoutMs: 20000 },
      )
      if (r.exitCode === 0) lines = r.stdout.split(/\r?\n/)
    } catch {
      return null
    }
  }
  if (lines === null) return null
  return lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && PROC_RUN_RX.test(l))
    .filter(l => !/\bps -eo\b|Get-CimInstance|\bpgrep\b|\bgrep\b/.test(l))
    // the shell wrapper and the interpreter of one run show as separate processes; that's still one run
    .map(l => l.slice(0, 160))
}

function denial(reason: string, fix: string): { deny: string } {
  return { deny: `run-guard: ${reason}\n${fix}` }
}

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as Options

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'run-guard', description: 'Show the run-guard rules in force' })
    return next(e)
  })

  on('command.run', { command: 'run-guard' }, async () => {
    const hosts = hostsOf(opts)
    return {
      text: [
        'run-guard rules:',
        `• Overlapping test runs: ${opts.blockConcurrent === false ? 'allowed' : 'blocked'}`,
        `• Deleting test reports: ${opts.protectReports === false ? 'allowed' : 'blocked'}`,
        `• Protected hosts: ${hosts.length ? hosts.join(', ') : 'none set'}`,
        'Change these in /plugin → run-guard → configure.',
      ].join('\n'),
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cmd = e.command

    // 1. Protected hosts: never, whatever the command.
    for (const host of hostsOf(opts)) {
      if (mentionsHost(cmd, host)) {
        $.ui.toast(`run-guard blocked a command touching ${host}`)
        return denial(
          `"${host}" is a protected host; this command was not run.`,
          'Tell the user what you intended to run and why; they will run it themselves if appropriate. Do not try another route to the same host.',
        )
      }
    }

    // 2. Test evidence.
    if (opts.protectReports !== false && deletesReports(cmd)) {
      $.ui.toast('run-guard blocked deleting test reports')
      return denial(
        'this command would delete test reports/evidence (output.xml, logs, results folders).',
        'Write new runs to a fresh output directory instead (robot -d results/<timestamp>, playwright --output). If old results really must go, ask the user to delete them.',
      )
    }

    // 3. Overlapping runs.
    if (opts.blockConcurrent !== false && isTestRun(cmd)) {
      const running = await runningTests($)
      if (running === null) {
        $.ui.status('run-guard: could not list processes; overlap check skipped')
      } else if (running.length > 0) {
        $.ui.toast('run-guard blocked an overlapping test run')
        return denial(
          `a test run is already in progress on this machine:\n  ${running.slice(0, 5).join('\n  ')}`,
          'Wait for it to finish (or ask the user whether to stop it). Overlapping runs share devices/brokers and corrupt each other\'s results.',
        )
      }
    }

    return next(e)
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : { deny: 'run-guard: the guard itself failed, so this command was not run. Ask the user to check the run-guard plugin (or disable it).' },
  )
}
