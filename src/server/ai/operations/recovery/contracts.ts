export const AI_RECONCILIATION_JOB_KIND = "admission.reconcile-reservation" as const;

export interface AIOperationalRecoveryPolicy {
  reservedStaleAfterMs: number;
  executingStaleAfterMs: number;
  scanBatchSize: number;
  reconciliationJob: {
    maxAttempts: number;
    timeoutMs: number;
    leaseDurationMs: number;
    backoffBaseMs: number;
    backoffMaxMs: number;
  };
}

export interface AIRecoveryRunResult {
  scanned: number;
  staleReservedReleased: number;
  staleExecutingSettled: number;
  reconciliationJobsEnsured: number;
  stillReconciling: number;
}
