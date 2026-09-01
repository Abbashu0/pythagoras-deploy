import type { ContentDatabase } from "../../../content/database";
import { openContentDatabase } from "../../../content/database";
import { AIBudgetAdmissionService, SQLiteAIBudgetAccountingReader } from "../../admission";
import { SQLiteAIBudgetRuntimeRepository } from "../../budget";
import { AIJobHandlerRegistry, AIJobQueueService } from "../jobs";
import { AIOutboxRouterRegistry, AIOutboxService } from "../outbox";
import {
  AIOperationalRecoveryService,
  createReconciliationJobHandler,
  defaultAIOperationalRecoveryPolicy,
  type AIOperationalRecoveryPolicy,
} from "../recovery";
import { AIWorker } from "./worker";

export interface AIOperationsRuntime {
  database: ContentDatabase;
  handlers: AIJobHandlerRegistry;
  jobs: AIJobQueueService;
  outboxRouters: AIOutboxRouterRegistry;
  outbox: AIOutboxService;
  admission: AIBudgetAdmissionService;
  recovery: AIOperationalRecoveryService;
  worker: AIWorker;
}

export function createAIOperationsRuntime(options: {
  database?: ContentDatabase;
  recoveryPolicy?: AIOperationalRecoveryPolicy;
  pollIntervalMs?: number;
  workerId?: string;
} = {}): AIOperationsRuntime {
  const database = options.database ?? openContentDatabase();
  const admission = new AIBudgetAdmissionService(database);
  const handlers = new AIJobHandlerRegistry();
  const jobs = new AIJobQueueService(database, handlers);
  handlers.register(createReconciliationJobHandler(admission));
  const outboxRouters = new AIOutboxRouterRegistry();
  const outbox = new AIOutboxService(database, outboxRouters, { jobQueue: jobs });
  const recovery = new AIOperationalRecoveryService(
    admission,
    new SQLiteAIBudgetRuntimeRepository(database),
    new SQLiteAIBudgetAccountingReader(database),
    jobs,
    options.recoveryPolicy ?? defaultAIOperationalRecoveryPolicy(),
  );
  const worker = new AIWorker({
    jobs,
    handlers,
    outbox,
    outboxRouters,
    recovery,
    pollIntervalMs: options.pollIntervalMs,
    workerId: options.workerId,
  });
  return { database, handlers, jobs, outboxRouters, outbox, admission, recovery, worker };
}
