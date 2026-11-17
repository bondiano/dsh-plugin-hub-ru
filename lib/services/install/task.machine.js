/**
 * DSH Plugin Hub — the community plugin marketplace for DeepSeek Harness.
 * Website: https://dsh-plugin.org
 * GitHub: https://github.com/dshplugin/dsh-plugin-hub
 *
 * installTask 状态机：任务状态唯一权威，task-queue.ts 的每次 status 写入都必须经
 * nextInstallTaskStatus 走机器转移（非法转移抛错，绝不静默）。机器与
 * extensions/dsh/machines/machines/dsh-plugin-hub-ru.mjs 同源，按真实行为做了修正：
 * - failed --RETRY--> running：allowBuilds 恢复路径把首次失败的任务重置为 running 重试一次；
 * - failed --FAIL--> failed / done --FAIL--> failed：重试尝试的前置失败可重复落 failed，
 *   装后入口校验发现分发文件缺失时把已标 done 的任务改判 failed。
 * cancelled 仍是唯一不可离开的终态。
 */
import { createMachine, transition } from 'xstate';
/** 状态表独立成常量：键集与 InstallTaskStatus 的双向一致性由下方编译期断言保证。 */
const states = {
    pending: { on: { START: 'running', CANCEL: 'cancelled' } },
    running: { on: { DONE: 'done', FAIL: 'failed', CANCEL: 'cancelled' } },
    done: { on: { FAIL: 'failed' } },
    failed: { on: { RETRY: 'running', FAIL: 'failed' } },
    cancelled: { type: 'final' },
};
export const installTaskMachine = createMachine({
    id: 'installTask',
    initial: 'pending',
    description: 'One plugin-hub mutation task: queued, running one dsh child, then done, failed or cancelled.',
    states,
});
const statesExactlyMatchStatus = true;
void statesExactlyMatchStatus;
/** 纯转移（不建 actor）：按当前状态与事件派生下一状态；非法转移抛错。 */
export function nextInstallTaskStatus(from, event) {
    const snapshot = installTaskMachine.resolveState({ value: from });
    const eventObject = { type: event };
    if (!snapshot.can(eventObject)) {
        throw new Error(`illegal installTask transition: ${from} --${event}-->`);
    }
    return transition(installTaskMachine, snapshot, eventObject)[0].value;
}
