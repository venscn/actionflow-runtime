import type { ActionRunRecord, FlowRunRecord } from "./types.js";

export interface StateStore {
  saveActionRun(run: ActionRunRecord): void;
  getActionRun(runId: string): ActionRunRecord | undefined;
  listActionRuns(): readonly ActionRunRecord[];
  saveFlowRun(run: FlowRunRecord): void;
  getFlowRun(flowRunId: string): FlowRunRecord | undefined;
  listFlowRuns(): readonly FlowRunRecord[];
  deleteActionRun(runId: string): boolean;
  deleteFlowRun(flowRunId: string): boolean;
  clear(): void;
}

export interface StateStoreRunBatch {
  flowRun?: FlowRunRecord;
  actionRuns?: ActionRunRecord[];
}

export interface BatchStateStore extends StateStore {
  saveRunBatch(batch: StateStoreRunBatch): void;
}

export interface WaitingRunIndexEntry {
  runId: string;
  flowRunId?: string;
  nodeId?: string;
  actionId: string;
  actionVersion?: string;
  waitReason: string;
  status: "waiting";
  indexedAt: string;
}

export interface WaitingRunFilter {
  waitReason?: string;
  flowRunId?: string;
  actionId?: string;
}

export interface WaitingIndexStore extends StateStore {
  indexWaitingActionRun(run: ActionRunRecord): void;
  removeWaitingActionRun(runId: string): void;
  listWaitingActionRuns(filter?: WaitingRunFilter): readonly WaitingRunIndexEntry[];
}

export function supportsRunBatch(store: StateStore): store is BatchStateStore {
  return typeof (store as { saveRunBatch?: unknown }).saveRunBatch === "function";
}

export function supportsWaitingIndex(store: StateStore): store is WaitingIndexStore {
  const candidate = store as {
    indexWaitingActionRun?: unknown;
    removeWaitingActionRun?: unknown;
    listWaitingActionRuns?: unknown;
  };

  return (
    typeof candidate.indexWaitingActionRun === "function" &&
    typeof candidate.removeWaitingActionRun === "function" &&
    typeof candidate.listWaitingActionRuns === "function"
  );
}

export class MemoryStateStore implements BatchStateStore, WaitingIndexStore {
  private readonly actionRuns = new Map<string, ActionRunRecord>();
  private readonly flowRuns = new Map<string, FlowRunRecord>();
  private readonly waitingRuns = new Map<string, WaitingRunIndexEntry>();

  saveActionRun(run: ActionRunRecord): void {
    this.actionRuns.set(actionRunKey(run), run);
  }

  getActionRun(runId: string): ActionRunRecord | undefined {
    return this.actionRuns.get(runId);
  }

  listActionRuns(): readonly ActionRunRecord[] {
    return [...this.actionRuns.values()];
  }

  saveFlowRun(run: FlowRunRecord): void {
    this.flowRuns.set(run.id, run);
  }

  getFlowRun(flowRunId: string): FlowRunRecord | undefined {
    return this.flowRuns.get(flowRunId);
  }

  listFlowRuns(): readonly FlowRunRecord[] {
    return [...this.flowRuns.values()];
  }

  deleteActionRun(runId: string): boolean {
    return this.actionRuns.delete(runId);
  }

  deleteFlowRun(flowRunId: string): boolean {
    return this.flowRuns.delete(flowRunId);
  }

  clear(): void {
    this.actionRuns.clear();
    this.flowRuns.clear();
    this.waitingRuns.clear();
  }

  saveRunBatch(batch: StateStoreRunBatch): void {
    if (batch.flowRun) {
      this.saveFlowRun(batch.flowRun);
    }

    for (const actionRun of batch.actionRuns ?? []) {
      this.saveActionRun(actionRun);
    }
  }

  indexWaitingActionRun(run: ActionRunRecord): void {
    if (run.status !== "waiting") {
      throw new Error("ActionRun is not waiting");
    }

    if (typeof run.waitReason !== "string" || run.waitReason.length === 0) {
      throw new Error("waitReason is required");
    }

    const runId = actionRunKey(run);
    const entry: WaitingRunIndexEntry = {
      runId,
      actionId: run.actionId,
      waitReason: run.waitReason,
      status: "waiting",
      indexedAt: new Date().toISOString()
    };

    if (run.actionVersion !== undefined) {
      entry.actionVersion = run.actionVersion;
    }

    const prefix = parseFlowRunPrefix(runId);
    if (prefix) {
      entry.flowRunId = prefix.flowRunId;
      entry.nodeId = prefix.nodeId;
    }

    this.waitingRuns.set(runId, entry);
  }

  removeWaitingActionRun(runId: string): void {
    this.waitingRuns.delete(runId);
  }

  listWaitingActionRuns(filter: WaitingRunFilter = {}): readonly WaitingRunIndexEntry[] {
    return [...this.waitingRuns.values()]
      .filter((entry) => matchesWaitingFilter(entry, filter))
      .sort((left, right) => left.runId.localeCompare(right.runId));
  }
}

function actionRunKey(run: ActionRunRecord): string {
  return run.runId ?? run.id;
}

function parseFlowRunPrefix(runId: string): { flowRunId: string; nodeId: string } | undefined {
  const separatorIndex = runId.indexOf(":");

  if (separatorIndex < 0) {
    return undefined;
  }

  return {
    flowRunId: runId.slice(0, separatorIndex),
    nodeId: runId.slice(separatorIndex + 1)
  };
}

function matchesWaitingFilter(entry: WaitingRunIndexEntry, filter: WaitingRunFilter): boolean {
  if (filter.waitReason !== undefined && entry.waitReason !== filter.waitReason) {
    return false;
  }

  if (filter.flowRunId !== undefined && entry.flowRunId !== filter.flowRunId) {
    return false;
  }

  if (filter.actionId !== undefined && entry.actionId !== filter.actionId) {
    return false;
  }

  return true;
}
