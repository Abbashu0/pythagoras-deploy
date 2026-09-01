import type { AIJobSpec } from "../jobs";

export const AI_OUTBOX_STATUSES = ["PENDING", "DISPATCHED", "FAILED", "CANCELLED"] as const;
export type AIOutboxStatus = (typeof AI_OUTBOX_STATUSES)[number];

export interface AIOutboxEvent {
  id: string;
  eventType: string;
  payloadVersion: number;
  payloadJson: string;
  payloadHash: string;
  dedupeKey: string;
  status: AIOutboxStatus;
  scheduledAt: number;
  dispatchedJobId: string | null;
  safeErrorCode: string | null;
  createdAt: number;
  dispatchedAt: number | null;
}

export interface AIOutboxOperationalView {
  id: string;
  eventType: string;
  payloadVersion: number;
  payloadHash: string;
  dedupeKey: string;
  status: AIOutboxStatus;
  scheduledAt: number;
  dispatchedJobId: string | null;
  safeErrorCode: string | null;
  createdAt: number;
  dispatchedAt: number | null;
}

export interface AIOutboxEventSpec {
  id?: string;
  eventType: string;
  payloadVersion: number;
  payload: Record<string, unknown>;
  dedupeKey: string;
  scheduledAt?: number;
}

export interface AIOutboxRoute {
  eventType: string;
  payloadVersion: number;
}

export interface AIOutboxRouterDefinition {
  eventType: string;
  payloadVersion: number;
  validatePayload(value: unknown): Record<string, unknown>;
  toJob(payload: Record<string, unknown>): AIJobSpec;
}

export interface AIOutboxOperationalSummary {
  status: AIOutboxStatus;
  count: number;
}
