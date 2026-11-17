import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installTaskMachine, nextInstallTaskStatus } from '../src/server/services/install/task.machine.ts'

test('installTask machine walks the real queue lifecycle (pending -> running -> done/failed)', () => {
  const initial = installTaskMachine.resolveState({ value: 'pending' })
  assert.equal(initial.value, 'pending')
  assert.equal(initial.can({ type: 'START' }), true)

  const running = nextInstallTaskStatus('pending', 'START')
  assert.equal(running, 'running')
  assert.equal(nextInstallTaskStatus(running, 'DONE'), 'done')
  assert.equal(nextInstallTaskStatus(running, 'FAIL'), 'failed')

  // allowBuilds 恢复：首次失败后重置为 running 重试一次（runPluginMutation）
  assert.equal(nextInstallTaskStatus('failed', 'RETRY'), 'running')
  // 重试尝试的前置失败可重复落 failed；装后入口校验可把已标 done 的任务改判 failed
  assert.equal(nextInstallTaskStatus('failed', 'FAIL'), 'failed')
  assert.equal(nextInstallTaskStatus('done', 'FAIL'), 'failed')
})

test('installTask machine cancels from pending and running', () => {
  assert.equal(nextInstallTaskStatus('pending', 'CANCEL'), 'cancelled')
  assert.equal(nextInstallTaskStatus('running', 'CANCEL'), 'cancelled')
})

test('installTask machine rejects illegal transitions', () => {
  assert.throws(() => nextInstallTaskStatus('pending', 'DONE'), /illegal installTask transition: pending --DONE-->/)
  assert.throws(() => nextInstallTaskStatus('pending', 'FAIL'), /illegal installTask transition: pending --FAIL-->/)
  assert.throws(() => nextInstallTaskStatus('done', 'START'), /illegal installTask transition: done --START-->/)
  assert.throws(() => nextInstallTaskStatus('cancelled', 'RETRY'), /illegal installTask transition: cancelled --RETRY-->/)
  assert.throws(() => nextInstallTaskStatus('cancelled', 'CANCEL'), /illegal installTask transition: cancelled --CANCEL-->/)
})
