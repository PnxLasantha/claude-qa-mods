import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'robot-progress',
  component: 'Pane',
  requestId: 'robot-progress',
  props: {
    title: 'Robot run',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const RUNNING = {
  state: 'running', suite: 'Mqtt', total: 40, done: 12, passed: 10, failed: 2, skipped: 0,
  percent: 30, elapsed_s: 125, eta_s: 290,
  current_test: 'Mqtt.Broker.Reconnect After Drop', current_test_elapsed_s: 14,
  current_keyword: 'MQTT.Wait For Message',
  recent_failures: [{ test: 'Mqtt.Broker.Qos2 Delivery', message: 'Timeout after 10s\nmore', duration_s: 10 }],
  updated_at: '2026-10-25 18:30:00', pid: 4242,
}

test('empty pane before any run', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /No Robot run yet/ }))?.text).toBe('No Robot run yet this session.')
  await ui.unmount()
})

test('running state shows progress, current test and failures on every surface', async ($, on) => {
  on('state.get', () => ({
    value: { value: { shape: 'view-1', value: { progress: RUNNING, mtimeMs: 1, isStale: false } }, version: 1 },
  }))
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Running/ }))?.text).toContain('Mqtt')
    expect(await ui.find({ type: 'Text', text: /30%/ })).toBeTruthy()
    // 10 passed of 12 run: floored, words not glyphs
    const counts = await ui.find({ type: 'Text', text: /83% pass/ })
    expect(counts?.text).toContain('10 passed')
    expect(counts?.text ?? '').not.toMatch(/[✔✘⤼]/)
    expect(await ui.find({ type: 'Text', text: /Reconnect After Drop/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Wait For Message/ })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /Timeout/ }))?.text).not.toContain('more')
    await ui.unmount()
  }
})

test('stale run is flagged', async ($, on) => {
  on('state.get', () => ({
    value: { value: { shape: 'view-1', value: { progress: RUNNING, mtimeMs: 1, isStale: true } }, version: 1 },
  }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /STALLED/ })).toBeTruthy()
  await ui.unmount()
})
