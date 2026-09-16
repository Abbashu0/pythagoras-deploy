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
