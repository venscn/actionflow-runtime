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

export function supportsRunBatch(store: StateStore): store is BatchStateStore {
  return typeof (store as { saveRunBatch?: unknown }).saveRunBatch === "function";
}

export class MemoryStateStore implements BatchStateStore {
  private readonly actionRuns = new Map<string, ActionRunRecord>();
  private readonly flowRuns = new Map<string, FlowRunRecord>();

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
  }

  saveRunBatch(batch: StateStoreRunBatch): void {
    if (batch.flowRun) {
      this.saveFlowRun(batch.flowRun);
    }

    for (const actionRun of batch.actionRuns ?? []) {
      this.saveActionRun(actionRun);
    }
  }
}

function actionRunKey(run: ActionRunRecord): string {
  return run.runId ?? run.id;
}
