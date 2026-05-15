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

export type ProcessedEventStatus = "started" | "completed" | "failed";

export interface ProcessedEventRecord {
  eventId: string;
  eventName: string;
  status: ProcessedEventStatus;
  firstSeenAt: string;
  updatedAt: string;
  attemptCount: number;
  matchedRunIds: string[];
  recoveredFlowRunIds: string[];
  error?: string;
}

export interface ProcessedEventStore extends StateStore {
  getProcessedEvent(eventId: string): ProcessedEventRecord | undefined;
  saveProcessedEvent(record: ProcessedEventRecord): void;
  listProcessedEvents(): readonly ProcessedEventRecord[];
  deleteProcessedEvent(eventId: string): boolean;
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

export function supportsProcessedEvents(store: StateStore): store is ProcessedEventStore {
  const candidate = store as {
    getProcessedEvent?: unknown;
    saveProcessedEvent?: unknown;
    listProcessedEvents?: unknown;
    deleteProcessedEvent?: unknown;
  };

  return (
    typeof candidate.getProcessedEvent === "function" &&
    typeof candidate.saveProcessedEvent === "function" &&
    typeof candidate.listProcessedEvents === "function" &&
    typeof candidate.deleteProcessedEvent === "function"
  );
}

export class MemoryStateStore implements BatchStateStore, WaitingIndexStore, ProcessedEventStore {
  private readonly actionRuns = new Map<string, ActionRunRecord>();
  private readonly flowRuns = new Map<string, FlowRunRecord>();
  private readonly waitingRuns = new Map<string, WaitingRunIndexEntry>();
  private readonly processedEvents = new Map<string, ProcessedEventRecord>();

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
    this.processedEvents.clear();
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

  getProcessedEvent(eventId: string): ProcessedEventRecord | undefined {
    return this.processedEvents.get(eventId);
  }

  saveProcessedEvent(record: ProcessedEventRecord): void {
    validateProcessedEventRecord(record);
    this.processedEvents.set(record.eventId, record);
  }

  listProcessedEvents(): readonly ProcessedEventRecord[] {
    return [...this.processedEvents.values()].sort((left, right) => left.eventId.localeCompare(right.eventId));
  }

  deleteProcessedEvent(eventId: string): boolean {
    return this.processedEvents.delete(eventId);
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

function validateProcessedEventRecord(record: ProcessedEventRecord): void {
  if (typeof record.eventId !== "string" || record.eventId.length === 0) {
    throw new Error("eventId is required");
  }

  if (typeof record.eventName !== "string" || record.eventName.length === 0) {
    throw new Error("eventName is required");
  }

  if (!isProcessedEventStatus(record.status)) {
    throw new Error("Invalid processed event status");
  }

  if (typeof record.firstSeenAt !== "string" || record.firstSeenAt.length === 0) {
    throw new Error("firstSeenAt is required");
  }

  if (typeof record.updatedAt !== "string" || record.updatedAt.length === 0) {
    throw new Error("updatedAt is required");
  }

  if (!Number.isInteger(record.attemptCount) || record.attemptCount < 0) {
    throw new Error("attemptCount must be a non-negative integer");
  }

  if (!isNonEmptyStringArray(record.matchedRunIds)) {
    throw new Error("matchedRunIds must be an array of non-empty strings");
  }

  if (!isNonEmptyStringArray(record.recoveredFlowRunIds)) {
    throw new Error("recoveredFlowRunIds must be an array of non-empty strings");
  }

  if (record.error !== undefined && typeof record.error !== "string") {
    throw new Error("error must be a string");
  }
}

function isProcessedEventStatus(status: unknown): status is ProcessedEventStatus {
  return status === "started" || status === "completed" || status === "failed";
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}
