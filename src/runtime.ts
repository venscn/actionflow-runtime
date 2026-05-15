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
  supportsRunBatch,
  supportsWaitingIndex,
  type StateStore,
  type StateStoreRunBatch
} from "./state-store.js";
import type { ActionDefinition, ActionRunRecord, FlowDefinition, FlowRunRecord } from "./types.js";

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
