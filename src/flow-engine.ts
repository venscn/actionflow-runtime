import type { FlowDefinition, FlowRunRecord, FlowRunStatus } from "./types.js";

export function createFlowRun(params: {
  id: string;
  flow: FlowDefinition;
  status?: FlowRunStatus;
}): FlowRunRecord {
  return {
    id: params.id,
    flowId: params.flow.id,
    currentNodeId: params.flow.root.id,
    status: params.status ?? "ready"
  };
}

export class FlowEngine {
  createRun(id: string, flow: FlowDefinition): FlowRunRecord {
    return createFlowRun({ id, flow });
  }
}
