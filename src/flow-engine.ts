import { createActionRun, resumeActionRun, runActionOnce } from "./action-run.js";
import type { ActionRegistry } from "./action-registry.js";
import type {
  ActionContext,
  ActionFlowNode,
  ActionRunRecord,
  FlowDefinition,
  FlowNode,
  FlowRunRecord,
  FlowRunStatus
} from "./types.js";

export interface FlowNodeRunRecord {
  nodeId: string;
  status: FlowRunStatus;
  actionRunId?: string;
  output?: unknown;
  error?: unknown;
}

export interface FlowEngineRunRecord extends FlowRunRecord {
  nodeRuns: Record<string, FlowNodeRunRecord>;
  actionRuns: Record<string, ActionRunRecord>;
  sequenceCursors: Record<string, number>;
}

interface NodeStepResult {
  run: FlowEngineRunRecord;
  status: FlowRunStatus;
}

export function createFlowRun(params: {
  id: string;
  flow: FlowDefinition;
  status?: FlowRunStatus;
}): FlowEngineRunRecord {
  return {
    id: params.id,
    flowId: params.flow.id,
    currentNodeId: params.flow.root.id,
    status: params.status ?? "ready",
    nodeRuns: {},
    actionRuns: {},
    sequenceCursors: {}
  };
}

export class FlowEngine {
  constructor(private readonly registry?: ActionRegistry) {}

  createRun(id: string, flow: FlowDefinition): FlowEngineRunRecord {
    return createFlowRun({ id, flow });
  }

  async tick(flowRun: FlowEngineRunRecord, flow: FlowDefinition): Promise<FlowEngineRunRecord> {
    if (!this.registry) {
      return failFlow(flowRun, flow.root.id, new Error("FlowEngine requires an ActionRegistry to execute flows"));
    }

    if (flowRun.status === "done" || flowRun.status === "failed" || flowRun.status === "waiting") {
      return flowRun;
    }

    const nextRun: FlowEngineRunRecord = {
      ...flowRun,
      status: "running",
      nodeRuns: { ...flowRun.nodeRuns },
      actionRuns: { ...flowRun.actionRuns },
      sequenceCursors: { ...flowRun.sequenceCursors }
    };
    const result = await this.runNode(nextRun, flow.root);

    return {
      ...result.run,
      status: result.status
    };
  }

  private async runNode(flowRun: FlowEngineRunRecord, node: FlowNode): Promise<NodeStepResult> {
    if (node.type === "action") {
      return this.runActionNode(flowRun, node);
    }

    if (node.type === "sequence") {
      return this.runSequenceNode(flowRun, node);
    }

    return {
      run: failFlow(flowRun, node.id, new Error("Parallel flow nodes are not supported yet")),
      status: "failed"
    };
  }

  private async runSequenceNode(
    flowRun: FlowEngineRunRecord,
    node: Extract<FlowNode, { type: "sequence" }>
  ): Promise<NodeStepResult> {
    let cursor = flowRun.sequenceCursors[node.id] ?? 0;
    flowRun.nodeRuns[node.id] = {
      nodeId: node.id,
      status: "running"
    };

    while (cursor < node.steps.length) {
      const step = node.steps[cursor];
      flowRun.currentNodeId = step.id;
      const result = await this.runNode(flowRun, step);
      flowRun = result.run;

      if (result.status === "failed") {
        flowRun.nodeRuns[node.id] = {
          nodeId: node.id,
          status: "failed"
        };
        return { run: flowRun, status: "failed" };
      }

      if (result.status === "done") {
        cursor += 1;
        flowRun.sequenceCursors[node.id] = cursor;
        continue;
      }

      flowRun.sequenceCursors[node.id] = cursor;
      flowRun.nodeRuns[node.id] = {
        nodeId: node.id,
        status: result.status
      };
      return { run: flowRun, status: result.status };
    }

    flowRun.currentNodeId = node.id;
    flowRun.nodeRuns[node.id] = {
      nodeId: node.id,
      status: "done"
    };
    return { run: flowRun, status: "done" };
  }

  private async runActionNode(flowRun: FlowEngineRunRecord, node: ActionFlowNode): Promise<NodeStepResult> {
    const existingNodeRun = flowRun.nodeRuns[node.id];

    if (existingNodeRun?.status === "done" || existingNodeRun?.status === "failed" || existingNodeRun?.status === "waiting") {
      return {
        run: flowRun,
        status: existingNodeRun.status
      };
    }

    const action = this.registry?.get(node.action);

    if (!action) {
      const error = new Error(`Action not found: ${node.action}`);
      flowRun.nodeRuns[node.id] = {
        nodeId: node.id,
        status: "failed",
        error
      };
      return { run: flowRun, status: "failed" };
    }

    const actionRunId = existingNodeRun?.actionRunId ?? `${flowRun.id}:${node.id}`;
    const context = createFlowActionContext();
    const actionRun =
      flowRun.actionRuns[node.id] ??
      createActionRun({
        id: actionRunId,
        actionId: action.id,
        actionVersion: action.version,
        input: node.input
      });
    const nextActionRun =
      action.mode === "sliceable"
        ? await resumeActionRun({ run: actionRun, action, context })
        : await runActionOnce({ runId: actionRunId, action, input: node.input, context });

    flowRun.actionRuns[node.id] = nextActionRun;
    flowRun.nodeRuns[node.id] = {
      nodeId: node.id,
      status: actionStatusToFlowStatus(nextActionRun.status),
      actionRunId: nextActionRun.runId,
      output: nextActionRun.output,
      error: nextActionRun.error
    };

    return {
      run: flowRun,
      status: actionStatusToFlowStatus(nextActionRun.status)
    };
  }
}

function actionStatusToFlowStatus(status: ActionRunRecord["status"]): FlowRunStatus {
  if (status === "ready") {
    return "running";
  }

  return status;
}

function failFlow(flowRun: FlowEngineRunRecord, nodeId: string, error: unknown): FlowEngineRunRecord {
  return {
    ...flowRun,
    status: "failed",
    currentNodeId: nodeId,
    nodeRuns: {
      ...flowRun.nodeRuns,
      [nodeId]: {
        nodeId,
        status: "failed",
        error
      }
    },
    actionRuns: { ...flowRun.actionRuns },
    sequenceCursors: { ...flowRun.sequenceCursors }
  };
}

function createFlowActionContext(): ActionContext {
  const startedAt = Date.now();
  const deadline = startedAt + 1_000;

  return {
    now: () => Date.now(),
    deadline: () => deadline,
    remainingMs: () => Math.max(0, deadline - Date.now()),
    shouldYield: () => false,
    log: () => undefined
  };
}
