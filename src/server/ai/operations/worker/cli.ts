import { createAIOperationsRuntime, type AIOperationsRuntime } from "./runtime";
import { AIJobError } from "../jobs";

async function main(): Promise<void> {
  let runtime: AIOperationsRuntime | null = null;
  try {
    runtime = createAIOperationsRuntime();
    const once = process.argv.includes("--once");
    const stop = () => runtime?.worker.requestShutdown();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    if (once) await runtime.worker.runOnce();
    else await runtime.worker.runContinuous();
  } catch (error) {
    if (error instanceof AIJobError) console.error("AI worker stopped", error.code);
    else console.error("AI worker stopped");
    process.exitCode = 1;
  } finally {
    runtime?.database.close();
  }
}

void main();
