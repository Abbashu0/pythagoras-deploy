import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("Next traces the Python Worker entry and it boots in the server runtime", async (t) => {
  const tracePath = path.join(
    process.cwd(),
    ".next",
    "server",
    "app",
    "api",
    "admin",
    "local",
    "ai",
    "models",
    "[modelId]",
    "chat",
    "route.js.nft.json",
  );
  let trace: string;
  try {
    trace = await readFile(tracePath, "utf8");
  } catch {
    t.skip("Run npm run build before the Next runtime Worker integration test.");
    return;
  }
  assert.match(trace, /src\/server\/ai\/ephemeral-python\/worker\.mjs/u);
  assert.match(trace, /node_modules\/pyodide/u);

  const workerEntry = path.join(
    process.cwd(),
    "src",
    "server",
    "ai",
    "ephemeral-python",
    "worker.mjs",
  );
  assert.equal(existsSync(workerEntry), true);
  const worker = new Worker(pathToFileURL(workerEntry), {
    execArgv: [],
    env: {
      PATH: process.env.PATH,
      NODE_PATH: process.env.NODE_PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    },
  });
  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Next Worker asset bootstrap timed out."));
    }, 30_000);
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.on("message", (message: Record<string, unknown>) => {
      if (message.type === "ready") {
        worker.postMessage({ type: "execute", code: "import sympy as sp\nsp.factor(12)" });
      } else if (message.type === "result") {
        clearTimeout(timer);
        void worker.terminate();
        resolve(message.result as Record<string, unknown>);
      } else if (message.type === "bootstrap_error") {
        clearTimeout(timer);
        void worker.terminate();
        reject(new Error("Next Worker asset bootstrap failed."));
      }
    });
  });

  assert.equal(result.status, "ok");
  assert.equal(result.result, "12");
});
