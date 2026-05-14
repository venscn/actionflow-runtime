import { ActionRegistry, FlowEngine } from "../src/index.js";
import type { ActionDefinition, FlowDefinition } from "../src/index.js";

type CountState = {
  count: number;
};

function createCountAction(id: string, target: number): ActionDefinition<number, number, CountState> {
  return {
    id,
    version: "1.0.0",
    mode: "sliceable",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: ["console.log"],
    start: (input) => ({ count: input }),
    resume: (state) => {
      console.log(`${id}: count=${state.count}`);

      const next = { count: state.count + 1 };

      if (next.count >= target) {
        return { type: "done", output: next.count };
      }

      return { type: "yield", state: next };
    }
  };
}

const registry = new ActionRegistry();

registry.register(createCountAction("count.a", 2));
registry.register(createCountAction("count.b", 3));
registry.register(createCountAction("count.c", 4));

const flow: FlowDefinition = {
  id: "basic-parallel",
  version: "1.0.0",
  root: {
    type: "parallel",
    id: "parallel-root",
    branches: [
      { type: "action", id: "branch-a", action: "count.a", input: 0 },
      { type: "action", id: "branch-b", action: "count.b", input: 0 },
      { type: "action", id: "branch-c", action: "count.c", input: 0 }
    ]
  }
};

const engine = new FlowEngine(registry);
let flowRun = engine.createRun("flow-run-basic-parallel", flow);
let tickIndex = 0;

while (flowRun.status !== "done" && flowRun.status !== "failed") {
  flowRun = await engine.tick(flowRun, flow, { frameBudgetMs: 2, maxSliceMs: 1 });

  const branchStatus = ["branch-a", "branch-b", "branch-c"]
    .map((branchId) => `${branchId}:${flowRun.nodeRuns[branchId]?.status ?? "ready"}`)
    .join(", ");

  console.log(`tick ${tickIndex}: flow=${flowRun.status}; ${branchStatus}`);
  tickIndex += 1;
}

console.log("outputs:");
for (const branchId of ["branch-a", "branch-b", "branch-c"]) {
  console.log(`${branchId}: ${String(flowRun.nodeRuns[branchId]?.output)}`);
}
