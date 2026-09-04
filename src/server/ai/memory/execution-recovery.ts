import type { AIJob, AIJobTerminalReconciliationResult } from "../operations/jobs";
import type { AIMemoryExecutionService } from "./execution-service";

/** Small named recovery boundary for runtime wiring and operational tests. */
export class AIMemoryExecutionRecoveryService {
  constructor(private readonly executions: AIMemoryExecutionService) {}

  reconcile(job: AIJob, now: number): void {
    this.executions.reconcile(job, now);
  }

  reconcilePending(input: { limit: number; now: number }): AIJobTerminalReconciliationResult {
    return this.executions.reconcilePending(input);
  }
}
