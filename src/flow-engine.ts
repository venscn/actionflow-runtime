import type { Flow, FlowRunRecord, FlowRunStatus } from "./types.js";

export function createFlowRun(params: {
  id: string;
  flow: Flow;
  status?: FlowRunStatus;
}): FlowRunRecord {
  return {
    id: params.id,
    flowId: params.flow.id,
    currentNodeId: params.flow.nodes[0]?.id,
    status: params.status ?? "pending"
  };
}

export class FlowEngine {
  createRun(id: string, flow: Flow): FlowRunRecord {
    return createFlowRun({ id, flow });
  }
}
