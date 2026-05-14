import { createActionRun, resumeActionRun, runActionOnce } from "./action-run.js";
import type { ActionRegistry } from "./action-registry.js";
import { SliceScheduler } from "./slice-scheduler.js";
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
  parallelCursors: Record<string, number>;
}

export interface FlowTickOptions {
  frameBudgetMs?: number;
  maxSliceMs?: number;
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
    sequenceCursors: {},
    parallelCursors: {}
  };
}

export class FlowEngine {
  constructor(private readonly registry?: ActionRegistry) {}

  createRun(id: string, flow: FlowDefinition): FlowEngineRunRecord {
    return createFlowRun({ id, flow });
  }

  async tick(flowRun: FlowEngineRunRecord, flow: FlowDefinition, options: FlowTickOptions = {}): Promise<FlowEngineRunRecord> {
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
      sequenceCursors: { ...flowRun.sequenceCursors },
      parallelCursors: { ...flowRun.parallelCursors }
    };
    const result = await this.runNode(nextRun, flow.root, options);

    return {
      ...result.run,
      status: result.status
    };
  }

  private async runNode(flowRun: FlowEngineRunRecord, node: FlowNode, options: FlowTickOptions): Promise<NodeStepResult> {
    if (node.type === "action") {
      return this.runActionNode(flowRun, node);
    }

    if (node.type === "sequence") {
      return this.runSequenceNode(flowRun, node, options);
    }

    return this.runParallelNode(flowRun, node, options);
  }

  private async runSequenceNode(
    flowRun: FlowEngineRunRecord,
    node: Extract<FlowNode, { type: "sequence" }>,
    options: FlowTickOptions
  ): Promise<NodeStepResult> {
    let cursor = flowRun.sequenceCursors[node.id] ?? 0;
    flowRun.nodeRuns[node.id] = {
      nodeId: node.id,
      status: "running"
    };

    while (cursor < node.steps.length) {
      const step = node.steps[cursor];
      flowRun.currentNodeId = step.id;
      const result = await this.runNode(flowRun, step, options);
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

  private async runParallelNode(
    flowRun: FlowEngineRunRecord,
    node: Extract<FlowNode, { type: "parallel" }>,
    options: FlowTickOptions
  ): Promise<NodeStepResult> {
    flowRun.nodeRuns[node.id] = {
      nodeId: node.id,
      status: "running"
    };

    const scheduler = new SliceScheduler();
    let hasScheduledSliceable = false;

    const branchOffset = flowRun.parallelCursors[node.id] ?? 0;
    const orderedBranches = rotate(node.branches, branchOffset);

    for (const branch of orderedBranches) {
      if (branch.type !== "action") {
        const result = await this.runNode(flowRun, branch, options);
        flowRun = result.run;
        continue;
      }

      const existingNodeRun = flowRun.nodeRuns[branch.id];

      if (existingNodeRun?.status === "done" || existingNodeRun?.status === "failed" || existingNodeRun?.status === "waiting") {
        continue;
      }

      const action = this.registry?.get(branch.action);

      if (!action) {
        const error = new Error(`Action not found: ${branch.action}`);
        flowRun.nodeRuns[branch.id] = {
          nodeId: branch.id,
          status: "failed",
          error
        };
        continue;
      }

      if (action.mode !== "sliceable") {
        const result = await this.runActionNode(flowRun, branch);
        flowRun = result.run;
        continue;
      }

      const actionRunId = existingNodeRun?.actionRunId ?? `${flowRun.id}:${branch.id}`;
      const actionRun =
        flowRun.actionRuns[branch.id] ??
        createActionRun({
          id: actionRunId,
          actionId: action.id,
          actionVersion: action.version,
          input: branch.input
        });

      scheduler.add(actionRun, action);
      hasScheduledSliceable = true;
    }

    if (hasScheduledSliceable) {
      const report = await scheduler.runFrame({
        frameBudgetMs: options.frameBudgetMs ?? Number.POSITIVE_INFINITY,
        maxSliceMs: options.maxSliceMs ?? 1
      });
      flowRun.parallelCursors[node.id] = node.branches.length > 0 ? (branchOffset + report.slicesRun) % node.branches.length : 0;

      for (const actionRun of scheduler.listRuns()) {
        const branch = node.branches.find((candidate) => candidate.type === "action" && `${flowRun.id}:${candidate.id}` === actionRun.runId);

        if (!branch) {
          continue;
        }

        flowRun.actionRuns[branch.id] = actionRun;
        flowRun.nodeRuns[branch.id] = {
          nodeId: branch.id,
          status: actionStatusToFlowStatus(actionRun.status),
          actionRunId: actionRun.runId,
          output: actionRun.output,
          error: actionRun.error
        };
      }
    }

    const branchStatuses = node.branches.map((branch) => flowRun.nodeRuns[branch.id]?.status ?? "ready");

    if (branchStatuses.includes("failed")) {
      flowRun.nodeRuns[node.id] = {
        nodeId: node.id,
        status: "failed"
      };
      return { run: flowRun, status: "failed" };
    }

    if (branchStatuses.every((status) => status === "done")) {
      flowRun.nodeRuns[node.id] = {
        nodeId: node.id,
        status: "done"
      };
      flowRun.currentNodeId = node.id;
      return { run: flowRun, status: "done" };
    }

    const hasActiveBranch = branchStatuses.some((status) => status === "ready" || status === "running");
    const status = hasActiveBranch ? "running" : "waiting";
    flowRun.nodeRuns[node.id] = {
      nodeId: node.id,
      status
    };
    return { run: flowRun, status };
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
    sequenceCursors: { ...flowRun.sequenceCursors },
    parallelCursors: { ...flowRun.parallelCursors }
  };
}

function rotate<T>(items: readonly T[], offset: number): T[] {
  if (items.length === 0) {
    return [];
  }

  const normalizedOffset = offset % items.length;
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
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
