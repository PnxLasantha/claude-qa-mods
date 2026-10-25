export type Failure = { test: string; message: string; duration_s: number }

export type Progress = {
  state: 'starting' | 'running' | 'finished'
  suite: string | null
  total: number
  done: number
  passed: number
  failed: number
  skipped: number
  percent: number
  elapsed_s: number
  eta_s: number | null
  current_test: string | null
  current_test_elapsed_s: number | null
  current_keyword: string | null
  recent_failures: Failure[]
  updated_at: string
  pid: number
}

export type View = { progress: Progress | null; mtimeMs: number; isStale: boolean }

declare module 'claude-code' {
  interface PluginState {
    'robot-progress': { view: Shaped<View> }
  }
}
