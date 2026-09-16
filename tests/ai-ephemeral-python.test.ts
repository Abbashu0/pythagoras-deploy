import assert from "node:assert/strict";
import test from "node:test";

import {
  executePythonInIsolatedWorker,
  PYTHON_MAX_CODE_BYTES,
} from "../src/server/ai/ephemeral-python/executor";

test("ephemeral Python executes computational code with bounded output", async () => {
  const result = await executePythonInIsolatedWorker(`
import math
import numpy as np
import sympy as sp
print(math.sqrt(16))
matrix_total = np.array([[1, 2], [3, 4]]).sum()
sp.factor(12)
`);
  assert.equal(result.status, "ok");
  assert.equal(result.stdout, "4.0\n");
  assert.equal(result.result, "12");
  assert.equal(result.stderr, "");
  assert.ok(result.durationMs >= 0);
});

test("ephemeral Python supports the Product Owner's exact SymPy matrix workload", async () => {
  const matrixCode = [
    "import sympy as sp",
    "A = sp.Matrix([",
    "   [-6,-9,-1,-2,-2,-5,-6,8],",
    "   [-7,9,4,-8,-9,-7,-3,-2],",
    "   [7,-9,8,-3,8,4,-2,5],",
    "   [9,-1,-9,-4,4,1,-1,-5],",
    "   [-3,1,-6,-7,3,-6,2,2],",
    "   [-1,-8,5,8,-6,3,-7,8],",
    "   [0,2,9,-3,-7,-8,-2,0],",
    "   [-7,-2,-6,3,-1,5,2,-4],",
    "])",
    "A.det()",
  ].join("\n");
  const determinant = await executePythonInIsolatedWorker(matrixCode);
  assert.equal(determinant.status, "ok");
  assert.equal(determinant.result, "-39758334");

  const trace = await executePythonInIsolatedWorker(`${matrixCode.replace("A.det()", "A.inv().trace()")}`);
  assert.equal(trace.status, "ok");
  assert.equal(trace.result, "-1319806/19879167");
});

test("ephemeral Python rejects host capability imports and dangerous builtins", async () => {
  const importResult = await executePythonInIsolatedWorker("import os");
  assert.equal(importResult.status, "error");
  assert.equal(importResult.errorType, "PythonError");
  assert.match(importResult.message ?? "", /Import is not allowed: os/u);

  const builtinResult = await executePythonInIsolatedWorker("open('secret.txt')");
  assert.equal(builtinResult.status, "error");
  assert.match(builtinResult.message ?? "", /(?:Name|Call) is not allowed: open/u);
});

test("ephemeral Python enforces code-size and hard wall-clock limits", async () => {
  const oversized = await executePythonInIsolatedWorker("x".repeat(PYTHON_MAX_CODE_BYTES + 1));
  assert.equal(oversized.status, "error");
  assert.equal(oversized.errorType, "CodeLimitError");

  const timedOut = await executePythonInIsolatedWorker("while True:\n    pass");
  assert.equal(timedOut.status, "timeout");
  assert.equal(timedOut.errorType, "TimeoutError");
});
