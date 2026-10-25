export type Cluster = {
  signature: string
  keyword: string
  message: string
  count: number
  tests: string[]
}

export type Report = {
  source: string
  kind: 'robot' | 'playwright'
  total: number
  failed: number
  clusters: Cluster[]
  at: string
}

declare module 'claude-code' {
  interface PluginState {
    'failure-triage': { report: Shaped<Report | null>; error: Shaped<string | null> }
  }
}
