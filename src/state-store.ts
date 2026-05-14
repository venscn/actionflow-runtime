import type { ActionRunRecord, FlowRunRecord } from "./types.js";

export interface StateStore {
  saveActionRun(actionRun: ActionRunRecord): void | Promise<void>;
  getActionRun(actionRunId: string): ActionRunRecord | undefined | Promise<ActionRunRecord | undefined>;
  saveFlowRun(flowRun: FlowRunRecord): void | Promise<void>;
  getFlowRun(flowRunId: string): FlowRunRecord | undefined | Promise<FlowRunRecord | undefined>;
}

export class MemoryStateStore implements StateStore {
  private readonly actionRuns = new Map<string, ActionRunRecord>();
  private readonly flowRuns = new Map<string, FlowRunRecord>();

  saveActionRun(actionRun: ActionRunRecord): void {
    this.actionRuns.set(actionRun.id, actionRun);
  }

  getActionRun(actionRunId: string): ActionRunRecord | undefined {
    return this.actionRuns.get(actionRunId);
  }

  saveFlowRun(flowRun: FlowRunRecord): void {
    this.flowRuns.set(flowRun.id, flowRun);
  }

  getFlowRun(flowRunId: string): FlowRunRecord | undefined {
    return this.flowRuns.get(flowRunId);
  }
}
