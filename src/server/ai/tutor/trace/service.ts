import { v7 as uuidv7 } from "uuid";

import type { AITutorResponseTrace, AITutorResponseTraceRepository, AITutorTraceCreateInput, AITutorTraceSafeErrorCode, AITutorTraceStatus } from "./contracts";
import { SQLiteAITutorResponseTraceRepository } from "./sqlite-repository";

/** M8A trace foundation; creation is explicit and belongs to the future M8B owner. */
export class AITutorResponseTraceService {
  private readonly repository: AITutorResponseTraceRepository;

  constructor(repository: AITutorResponseTraceRepository) {
    this.repository = repository;
  }

  static forDatabase(database: ConstructorParameters<typeof SQLiteAITutorResponseTraceRepository>[0]): AITutorResponseTraceService {
    return new AITutorResponseTraceService(new SQLiteAITutorResponseTraceRepository(database));
  }

  create(input: AITutorTraceCreateInput): AITutorResponseTrace {
    return this.repository.create(input);
  }

  getByResponse(responseId: string): AITutorResponseTrace | null {
    return this.repository.getByResponse(responseId);
  }

  getById(id: string): AITutorResponseTrace | null {
    return this.repository.getById(id);
  }

  listProjectionRefs(traceId: string) {
    return this.repository.listProjectionRefs(traceId);
  }

  listEvidenceRefs(traceId: string) {
    return this.repository.listEvidenceRefs(traceId);
  }

  transition(input: { id: string; expectedStatus: AITutorTraceStatus; status: AITutorTraceStatus; updatedAt: number; completedAt: number | null; safeErrorCode: AITutorTraceSafeErrorCode | null }) {
    return this.repository.transition(input);
  }
}

export function createEmptyTraceIdentity(): string {
  return uuidv7();
}
