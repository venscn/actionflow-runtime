import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ActionFlowRuntime, FileStateStore } from "../src/index.js";
import type { ActionDefinition, FlowDefinition } from "../src/index.js";

const rootDir = mkdtempSync(path.join(os.tmpdir(), "actionflow-file-store-example-"));

try {
  const firstRuntime = new ActionFlowRuntime({
    stateStore: new FileStateStore({ rootDir })
  });

  const action = createEchoAction();
  const flow = createEchoFlow();

  firstRuntime.registerAction(action);
  firstRuntime.registerFlow(flow);

  let run = firstRuntime.createRun("flow.echo", "flow-run-1");
  run = await firstRuntime.tick(run, "flow.echo");

  console.log(`saved run status: ${run.status}`);
  console.log(`saved output: ${String(run.actionRuns["node-1"]?.output)}`);

  const secondRuntime = new ActionFlowRuntime({
    stateStore: new FileStateStore({ rootDir })
  });

  secondRuntime.registerAction(action);
  secondRuntime.registerFlow(flow);

  const restoredRun = secondRuntime.restoreRun("flow-run-1");

  console.log(`restored run status: ${restoredRun.status}`);
  console.log(`restored output: ${String(restoredRun.actionRuns["node-1"]?.output)}`);
  console.log("restoreRun reloads saved records only; it does not automatically continue execution.");
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}

function createEchoAction(): ActionDefinition<null, string, never> {
  return {
    id: "echo",
    version: "1.0.0",
    mode: "instant",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run: () => ({ type: "done", output: "ok" })
  };
}

function createEchoFlow(): FlowDefinition {
  return {
    id: "flow.echo",
    version: "1.0.0",
    root: {
      type: "action",
      id: "node-1",
      action: "echo",
      input: null
    }
  };
}
