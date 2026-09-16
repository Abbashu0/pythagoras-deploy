import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";

export const PYTHON_EXECUTION_TIMEOUT_MS = 8_000;
export const PYTHON_BOOTSTRAP_TIMEOUT_MS = 30_000;
export const PYTHON_MAX_CODE_BYTES = 12 * 1024;

export interface PythonExecutionResult {
  status: "ok" | "error" | "timeout" | "cancelled";
  stdout?: string;
  stderr?: string;
  result?: string | null;
  errorType?: string;
  message?: string;
  durationMs: number;
}

export async function executePythonInIsolatedWorker(
  code: string,
  options: { signal?: AbortSignal } = {},
): Promise<PythonExecutionResult> {
  const startedAt = Date.now();
  if (Buffer.byteLength(code, "utf8") > PYTHON_MAX_CODE_BYTES) {
    return {
      status: "error",
      errorType: "CodeLimitError",
      message: "Python code exceeds the 12 KB limit.",
      durationMs: 0,
    };
  }
  if (options.signal?.aborted) {
    return { status: "cancelled", message: "Python execution was stopped.", durationMs: 0 };
  }

  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = constructPythonWorker();
    } catch (error) {
      resolve({
        status: "error",
        errorType: "PythonRuntimeError",
        message: safeWorkerMessage(error instanceof Error ? error.message : String(error)),
        durationMs: Math.max(0, Date.now() - startedAt),
      });
      return;
    }
    let settled = false;
    let phase: "bootstrap" | "execution" = "bootstrap";
    let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
    let executionTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: Omit<PythonExecutionResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      if (bootstrapTimer) clearTimeout(bootstrapTimer);
      if (executionTimer) clearTimeout(executionTimer);
      options.signal?.removeEventListener("abort", abort);
      void worker.terminate();
      resolve({ ...result, durationMs: Math.max(0, Date.now() - startedAt) });
    };
    const abort = () => finish({ status: "cancelled", message: "Python execution was stopped." });
    bootstrapTimer = setTimeout(() => {
      finish({ status: "timeout", errorType: "PythonBootstrapTimeout", message: "Python runtime startup timed out." });
    }, PYTHON_BOOTSTRAP_TIMEOUT_MS);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (message: unknown) => {
      if (!isRecord(message) || typeof message.type !== "string") {
        finish({ status: "error", errorType: "PythonRuntimeError", message: "Python worker returned an invalid result." });
        return;
      }
      if (message.type === "ready") {
        if (phase !== "bootstrap") return;
        phase = "execution";
        if (bootstrapTimer) clearTimeout(bootstrapTimer);
        executionTimer = setTimeout(() => {
          finish({ status: "timeout", errorType: "TimeoutError", message: "Python execution timed out." });
        }, PYTHON_EXECUTION_TIMEOUT_MS);
        try {
          worker.postMessage({ type: "execute", code });
        } catch (error) {
          finish({ status: "error", errorType: "PythonRuntimeError", message: safeWorkerMessage(error instanceof Error ? error.message : String(error)) });
        }
        return;
      }
      if (message.type === "bootstrap_error") {
        finish({
          status: "error",
          errorType: "PythonRuntimeError",
          message: safeWorkerMessage(typeof message.message === "string" ? message.message : "Python runtime startup failed."),
        });
        return;
      }
      if (message.type === "result") {
        finish(normalizeWorkerResult(message.result));
        return;
      }
      finish({ status: "error", errorType: "PythonRuntimeError", message: "Python worker returned an unknown message." });
    });
    worker.once("error", (error: Error) => {
      finish({ status: "error", errorType: "PythonRuntimeError", message: safeWorkerMessage(error.message) });
    });
    worker.once("exit", (code) => {
      if (settled) return;
      finish({
        status: "error",
        errorType: "PythonRuntimeError",
        message: "Python worker exited before returning a result.",
      });
    });
  });
}

function normalizeWorkerResult(value: unknown): Omit<PythonExecutionResult, "durationMs"> {
  if (!isRecord(value) || !["ok", "error", "timeout", "cancelled"].includes(String(value.status))) {
    return { status: "error", errorType: "PythonRuntimeError", message: "Python worker returned an invalid result." };
  }
  return {
    status: value.status as PythonExecutionResult["status"],
    ...(typeof value.stdout === "string" ? { stdout: value.stdout.slice(0, 32 * 1024) } : {}),
    ...(typeof value.stderr === "string" ? { stderr: value.stderr.slice(0, 16 * 1024) } : {}),
    ...(typeof value.result === "string" || value.result === null ? { result: value.result } : {}),
    ...(typeof value.errorType === "string" ? { errorType: value.errorType.slice(0, 120) } : {}),
    ...(typeof value.message === "string" ? { message: safeWorkerMessage(value.message) } : {}),
  };
}

function safeWorkerMessage(value: string): string {
  const line = value.split(/\r?\n/u).map((part) => part.trim()).filter(Boolean).at(-1) ?? "Python worker failed.";
  return line.replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*([^\\\s]+)/gu, "<path>/$1").slice(0, 16 * 1024);
}

function constructPythonWorker(): Worker {
  const sourceWorkerPath = resolve(
    process.cwd(),
    "src/server/ai/ephemeral-python/worker.mjs",
  );
  if (!existsSync(sourceWorkerPath)) {
    throw new Error("The Python Worker entry is unavailable at runtime.");
  }
  return new Worker(/* turbopackIgnore: true */ pathToFileURL(sourceWorkerPath), {
    execArgv: [],
    env: pythonWorkerEnvironment(),
  });
}

function pythonWorkerEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    NODE_PATH: process.env.NODE_PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
