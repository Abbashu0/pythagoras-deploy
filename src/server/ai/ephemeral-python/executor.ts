import { Worker } from "node:worker_threads";

export const PYTHON_EXECUTION_TIMEOUT_MS = 8_000;
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
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: { code },
    });
    let settled = false;
    const finish = (result: Omit<PythonExecutionResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      void worker.terminate();
      resolve({ ...result, durationMs: Math.max(0, Date.now() - startedAt) });
    };
    const abort = () => finish({ status: "cancelled", message: "Python execution was stopped." });
    const timer = setTimeout(
      () => finish({ status: "timeout", errorType: "TimeoutError", message: "Python execution timed out." }),
      PYTHON_EXECUTION_TIMEOUT_MS,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (result: Omit<PythonExecutionResult, "durationMs">) => finish(result));
    worker.once("error", (error: Error) =>
      finish({ status: "error", errorType: error.name || "WorkerError", message: safeWorkerMessage(error.message) }),
    );
  });
}

function safeWorkerMessage(value: string): string {
  const line = value.split(/\r?\n/u).map((part) => part.trim()).filter(Boolean).at(-1) ?? "Python worker failed.";
  return line.replace(/[A-Za-z]:\\[^\s]+/gu, "<path>").slice(0, 16 * 1024);
}
