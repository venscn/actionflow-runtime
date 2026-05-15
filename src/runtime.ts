import { ActionRegistry } from "./action-registry.js";
import { EventTriggerRegistry, type EventTriggerDefinition } from "./event-trigger.js";
import { FlowEngine, type FlowEngineRunRecord, type FlowTickOptions } from "./flow-engine.js";
import { FlowRegistry } from "./flow-registry.js";
import {
  checkPackageManifestRegistries,
  type PackageManifestRegistryCheckResult,
  type PackageManifestValidationResult,
  validatePackageManifest
} from "./package-manifest.js";
import {
  MemoryStateStore,
  supportsProcessedEvents,
  supportsRunBatch,
  supportsWaitingIndex,
  type ProcessedEventRecord,
  type StateStore,
  type StateStoreRunBatch,
  type WaitingRunIndexEntry
} from "./state-store.js";
import type { ActionDefinition, ActionRunRecord, FlowDefinition, FlowRunRecord } from "./types.js";

export interface RuntimeEvent {
  id: string;
  name: string;
  payload?: unknown;
  occurredAt?: string;
  source?: string;
}

export interface EventRecoverySkip {
  runId: string;
  reason: string;
}

export interface EventRecoveryResult {
  eventId: string;
  matched: readonly WaitingRunIndexEntry[];
  recovered: readonly FlowEngineRunRecord[];
  skipped: readonly EventRecoverySkip[];
}

export interface ActionFlowRuntimeDependencies {
  actionRegistry?: ActionRegistry;
  flowRegistry?: FlowRegistry;
  eventTriggerRegistry?: EventTriggerRegistry;
  stateStore?: StateStore;
}

export class ActionFlowRuntime {
  readonly actions: ActionRegistry;
  readonly flows: FlowRegistry;
  readonly triggers: EventTriggerRegistry;
  readonly store: StateStore;
  readonly engine: FlowEngine;

  constructor(dependencies: ActionFlowRuntimeDependencies = {}) {
    this.actions = dependencies.actionRegistry ?? new ActionRegistry();
    this.flows = dependencies.flowRegistry ?? new FlowRegistry();
    this.triggers = dependencies.eventTriggerRegistry ?? new EventTriggerRegistry();
    this.store = dependencies.stateStore ?? new MemoryStateStore();
    this.engine = new FlowEngine(this.actions);
  }

  registerAction(action: ActionDefinition): void {
    this.actions.register(action);
  }

  registerFlow(flow: FlowDefinition): void {
    this.flows.register(flow);
  }

  registerTrigger(trigger: EventTriggerDefinition): void {
    this.triggers.register(trigger);
  }

  checkPackageManifest(manifest: unknown): PackageManifestValidationResult | PackageManifestRegistryCheckResult {
    const validation = validatePackageManifest(manifest);

    if (!validation.valid) {
      return validation;
    }

    return checkPackageManifestRegistries({
      manifest: validation.manifest,
      actions: this.actions,
      flows: this.flows
    });
  }

  getProcessedEvent(eventId: string): ProcessedEventRecord | undefined {
    if (!supportsProcessedEvents(this.store)) {
      return undefined;
    }

    return this.store.getProcessedEvent(eventId);
  }

  saveProcessedEvent(record: ProcessedEventRecord): void {
    if (!supportsProcessedEvents(this.store)) {
      throw new Error("ProcessedEventStore is not supported");
    }

    this.store.saveProcessedEvent(record);
  }

  listProcessedEvents(): readonly ProcessedEventRecord[] {
    if (!supportsProcessedEvents(this.store)) {
      return [];
    }

    return this.store.listProcessedEvents();
  }

  deleteProcessedEvent(eventId: string): boolean {
    if (!supportsProcessedEvents(this.store)) {
      return false;
    }

    return this.store.deleteProcessedEvent(eventId);
  }

  matchWaitingRuns(event: RuntimeEvent): EventRecoveryResult {
    validateRuntimeEvent(event);

    if (!supportsWaitingIndex(this.store)) {
      return {
        eventId: event.id,
        matched: [],
        recovered: [],
        skipped: []
      };
    }

    return {
      eventId: event.id,
      matched: this.store.listWaitingActionRuns({ waitReason: event.name }),
      recovered: [],
      skipped: []
    };
  }

  previewEventRecovery(event: RuntimeEvent): EventRecoveryResult {
    const matchedResult = this.matchWaitingRuns(event);
    const recovered: FlowEngineRunRecord[] = [];
    const skipped: EventRecoverySkip[] = [];
    const restoredFlowRunIds = new Set<string>();

    for (const entry of matchedResult.matched) {
      if (typeof entry.flowRunId !== "string" || entry.flowRunId.length === 0) {
        skipped.push({
          runId: entry.runId,
          reason: "Missing flowRunId"
        });
        continue;
      }

      if (restoredFlowRunIds.has(entry.flowRunId)) {
        continue;
      }

      try {
        recovered.push(this.restoreRun(entry.flowRunId));
        restoredFlowRunIds.add(entry.flowRunId);
      } catch (error) {
        skipped.push({
          runId: entry.runId,
          reason: describeError(error)
        });
      }
    }

    return {
      eventId: matchedResult.eventId,
      matched: matchedResult.matched,
      recovered,
      skipped
    };
  }

  recoverWaitingRuns(event: RuntimeEvent): EventRecoveryResult {
    validateRuntimeEvent(event);

    if (!supportsProcessedEvents(this.store)) {
      return this.previewEventRecovery(event);
    }

    const existingRecord = this.store.getProcessedEvent(event.id);
    const firstSeenAt = existingRecord?.firstSeenAt ?? new Date().toISOString();
    const attemptCount = (existingRecord?.attemptCount ?? 0) + 1;

    this.store.saveProcessedEvent(
      createProcessedEventRecord({
        event,
        status: "started",
        firstSeenAt,
        attemptCount,
        matchedRunIds: [],
        recoveredFlowRunIds: []
      })
    );

    try {
      const result = this.previewEventRecovery(event);

      this.store.saveProcessedEvent(
        createProcessedEventRecord({
          event,
          status: "completed",
          firstSeenAt,
          attemptCount,
          matchedRunIds: result.matched.map((entry) => entry.runId),
          recoveredFlowRunIds: result.recovered.map((run) => run.id)
        })
      );

      return result;
    } catch (error) {
      this.store.saveProcessedEvent(
        createProcessedEventRecord({
          event,
          status: "failed",
          firstSeenAt,
          attemptCount,
          matchedRunIds: [],
          recoveredFlowRunIds: [],
          error: describeError(error)
        })
      );

      throw error;
    }
  }

  createRun(flowId: string, runId: string, version?: string): FlowEngineRunRecord {
    const flow = this.requireFlow(flowId, version);
    const run = this.engine.createRun(runId, flow);

    this.store.saveFlowRun(run);

    return run;
  }

  restoreRun(flowRunId: string): FlowEngineRunRecord {
    const storedRun = this.store.getFlowRun(flowRunId);

    if (!storedRun) {
      throw new Error(`FlowRun not found: ${flowRunId}`);
    }

    const restored = normalizeFlowEngineRunRecord(storedRun);
    const actionRunPrefix = `${flowRunId}:`;

    for (const actionRun of this.store.listActionRuns()) {
      if (!actionRun.runId.startsWith(actionRunPrefix)) {
        continue;
      }

      const nodeId = actionRun.runId.slice(actionRunPrefix.length);
      restored.actionRuns[nodeId] = actionRun;
    }

    return restored;
  }

  async tick(
    run: FlowEngineRunRecord,
    flowId: string,
    options?: FlowTickOptions,
    version?: string
  ): Promise<FlowEngineRunRecord> {
    const flow = this.requireFlow(flowId, version);
    const nextRun = await this.engine.tick(run, flow, options);
    const batch: StateStoreRunBatch = {
      flowRun: nextRun,
      actionRuns: Object.values(nextRun.actionRuns)
    };

    if (supportsRunBatch(this.store)) {
      this.store.saveRunBatch(batch);
      this.updateWaitingIndex(nextRun);
      return nextRun;
    }

    this.store.saveFlowRun(nextRun);

    for (const actionRun of batch.actionRuns ?? []) {
      this.store.saveActionRun(actionRun);
    }

    this.updateWaitingIndex(nextRun);

    return nextRun;
  }

  private updateWaitingIndex(run: FlowEngineRunRecord): void {
    if (!supportsWaitingIndex(this.store)) {
      return;
    }

    for (const actionRun of Object.values(run.actionRuns)) {
      const runId = actionRun.runId ?? actionRun.id;

      if (actionRun.status === "waiting" && typeof actionRun.waitReason === "string" && actionRun.waitReason.length > 0) {
        this.store.indexWaitingActionRun(actionRun);
      } else {
        this.store.removeWaitingActionRun(runId);
      }
    }
  }

  private requireFlow(flowId: string, version?: string): FlowDefinition {
    const flow = this.flows.get(flowId, version);

    if (!flow) {
      throw new Error(version ? `Flow not found: ${flowId}@${version}` : `Flow not found: ${flowId}`);
    }

    return flow;
  }
}

function normalizeFlowEngineRunRecord(run: FlowRunRecord): FlowEngineRunRecord {
  const candidate = run as FlowRunRecord & Partial<FlowEngineRunRecord>;

  return {
    ...run,
    nodeRuns: cloneRecord<FlowEngineRunRecord["nodeRuns"][string]>(candidate.nodeRuns),
    actionRuns: cloneRecord<ActionRunRecord>(candidate.actionRuns),
    sequenceCursors: cloneRecord<number>(candidate.sequenceCursors),
    parallelCursors: cloneRecord<number>(candidate.parallelCursors)
  };
}

function cloneRecord<T>(value: unknown): Record<string, T> {
  if (!isRecord(value)) {
    return {};
  }

  return { ...(value as Record<string, T>) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createProcessedEventRecord(params: {
  event: RuntimeEvent;
  status: ProcessedEventRecord["status"];
  firstSeenAt: string;
  attemptCount: number;
  matchedRunIds: string[];
  recoveredFlowRunIds: string[];
  error?: string;
}): ProcessedEventRecord {
  const record: ProcessedEventRecord = {
    eventId: params.event.id,
    eventName: params.event.name,
    status: params.status,
    firstSeenAt: params.firstSeenAt,
    updatedAt: new Date().toISOString(),
    attemptCount: params.attemptCount,
    matchedRunIds: params.matchedRunIds,
    recoveredFlowRunIds: params.recoveredFlowRunIds
  };

  if (params.error !== undefined) {
    record.error = params.error;
  }

  return record;
}

function validateRuntimeEvent(event: RuntimeEvent): void {
  if (!isRecord(event)) {
    throw new Error("Runtime event must be an object");
  }

  if (typeof event.id !== "string" || event.id.length === 0) {
    throw new Error("Runtime event id is required");
  }

  if (typeof event.name !== "string" || event.name.length === 0) {
    throw new Error("Runtime event name is required");
  }

  if ("occurredAt" in event && event.occurredAt !== undefined && typeof event.occurredAt !== "string") {
    throw new Error("Runtime event occurredAt must be a string");
  }

  if ("source" in event && event.source !== undefined && typeof event.source !== "string") {
    throw new Error("Runtime event source must be a string");
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
