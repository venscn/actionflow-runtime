import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ActionFlowRuntime, FileStateStore } from "../src/index.js";
import type { ActionDefinition, FlowDefinition } from "../src/index.js";

type CountState = {
  count: number;
};

const rootDir = mkdtempSync(path.join(os.tmpdir(), "actionflow-file-store-resume-"));

try {
  const firstRuntime = new ActionFlowRuntime({
    stateStore: new FileStateStore({ rootDir })
  });

  const action = createCountToTwoAction();
  const flow = createCountFlow();

  firstRuntime.registerAction(action);
  firstRuntime.registerFlow(flow);

  let run = firstRuntime.createRun("flow.count", "flow-run-1");
  run = await firstRuntime.tick(run, "flow.count");

  console.log(`saved run status after first tick: ${run.status}`);
  console.log(`saved state count: ${String((run.actionRuns["node-1"]?.state as CountState | undefined)?.count)}`);

  const secondRuntime = new ActionFlowRuntime({
    stateStore: new FileStateStore({ rootDir })
  });

  secondRuntime.registerAction(action);
  secondRuntime.registerFlow(flow);

  const restoredRun = secondRuntime.restoreRun("flow-run-1");

  console.log(`restored run status: ${restoredRun.status}`);
  console.log(
    `restored state count: ${String((restoredRun.actionRuns["node-1"]?.state as CountState | undefined)?.count)}`
  );
  console.log("restoreRun reloads saved records only; call tick explicitly to continue execution.");

  const resumedRun = await secondRuntime.tick(restoredRun, "flow.count");

  console.log(`resumed run status: ${resumedRun.status}`);
  console.log(`resumed output: ${String(resumedRun.actionRuns["node-1"]?.output)}`);
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}

function createCountToTwoAction(): ActionDefinition<number, number, CountState> {
  return {
    id: "count.to-two",
    version: "1.0.0",
    mode: "sliceable",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    start: (input) => ({ count: input }),
    resume: (state) => {
      const next = state.count + 1;

      if (next >= 2) {
        return { type: "done", output: next };
      }

      return { type: "yield", state: { count: next } };
    }
  };
}

function createCountFlow(): FlowDefinition {
  return {
    id: "flow.count",
    version: "1.0.0",
    root: {
      type: "action",
      id: "node-1",
      action: "count.to-two",
      input: 0
    }
  };
}
