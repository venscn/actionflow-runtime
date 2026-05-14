import { ActionRegistry } from "./action-registry.js";
import { EventTriggerRegistry, type EventTriggerDefinition } from "./event-trigger.js";
import { FlowEngine, type FlowEngineRunRecord, type FlowTickOptions } from "./flow-engine.js";
import { FlowRegistry } from "./flow-registry.js";
import { MemoryStateStore, type StateStore } from "./state-store.js";
import type { ActionDefinition, FlowDefinition } from "./types.js";

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

  createRun(flowId: string, runId: string, version?: string): FlowEngineRunRecord {
    const flow = this.requireFlow(flowId, version);
    const run = this.engine.createRun(runId, flow);

    this.store.saveFlowRun(run);

    return run;
  }

  async tick(
    run: FlowEngineRunRecord,
    flowId: string,
    options?: FlowTickOptions,
    version?: string
  ): Promise<FlowEngineRunRecord> {
    const flow = this.requireFlow(flowId, version);
    const nextRun = await this.engine.tick(run, flow, options);

    this.store.saveFlowRun(nextRun);

    for (const actionRun of Object.values(nextRun.actionRuns)) {
      this.store.saveActionRun(actionRun);
    }

    return nextRun;
  }

  private requireFlow(flowId: string, version?: string): FlowDefinition {
    const flow = this.flows.get(flowId, version);

    if (!flow) {
      throw new Error(version ? `Flow not found: ${flowId}@${version}` : `Flow not found: ${flowId}`);
    }

    return flow;
  }
}
