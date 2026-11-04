import { IdbCheckpointSaver } from './idb-saver';

export { IdbCheckpointSaver, idbThreadStore, type ThreadRecord, type ThreadStore } from './idb-saver';
export { createResumeGuardMiddleware, interruptedToolContent, readResumeState, type ResumeState } from './resume';

let shared: IdbCheckpointSaver | undefined;

/** 后台进程内共用一个检查点存储；它只缓存“本次生命周期写过哪些线程”，数据都在 IndexedDB。 */
export function getAgentCheckpointer(): IdbCheckpointSaver {
    shared ??= new IdbCheckpointSaver();
    return shared;
}
