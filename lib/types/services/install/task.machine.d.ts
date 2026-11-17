import type { InstallTaskStatus } from './install-types.ts';
export declare const installTaskMachine: import("xstate").StateMachine<import("xstate").MachineContext, import("xstate").AnyEventObject, Record<string, import("xstate").AnyActorRef>, import("xstate").ProvidedActor, import("xstate").ParameterizedObject, import("xstate").ParameterizedObject, string, import("xstate").StateValue, string, unknown, import("xstate").NonReducibleUnknown, import("xstate").EventObject, any, any, any>;
export type InstallTaskEvent = 'START' | 'CANCEL' | 'DONE' | 'FAIL' | 'RETRY';
/** 纯转移（不建 actor）：按当前状态与事件派生下一状态；非法转移抛错。 */
export declare function nextInstallTaskStatus(from: InstallTaskStatus, event: InstallTaskEvent): InstallTaskStatus;
