import { lookup } from "node:dns/promises";

import { getContentDatabase, type ContentDatabase } from "../content/database";
import { SQLiteAIProviderConfigRepository } from "./configuration";
import { AIProviderGatewayError, AI_PROVIDER_HTTP_LIMITS, createProviderOutboundPolicy, type AIProviderHttpRequest, type AIProviderHttpResponse, type AIProviderHttpTransport, type OutboundTargetPolicy, type ValidatedOutboundTarget } from "./gateway";
import { isLocalOmniRouteUrl } from "./local-omniroute";
import { createLocalAISecretStore, type AISecretStoreAdapter } from "./secrets";

export const AI_PROVIDER_CONNECTION_STRATEGY = "OPENAI_COMPATIBLE_MODELS_V1" as const;
export const AI_PROVIDER_CONNECTION_TIMEOUT_MS = 9_000;
const MAX_MODEL_PREVIEW = 50;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export type AIProviderConnectionStatus = "CONNECTED" | "AUTH_FAILED" | "UNREACHABLE" | "TIMEOUT" | "UNSUPPORTED" | "PROVIDER_ERROR";
export type AIProviderCredentialVerification = "NOT_PROVEN" | "REJECTED";

export interface AIProviderConnectionTestResult {
  status: AIProviderConnectionStatus;
  testedAt: number;
  latencyMs: number | null;
  httpStatus: number | null;
  modelCount: number | null;
  modelIds: string[];
  messageCode: string;
  strategy: typeof AI_PROVIDER_CONNECTION_STRATEGY;
  /** A successful public `/models` response proves reachability, not credential acceptance. */
  credentialVerification: AIProviderCredentialVerification;
}

export interface AIProviderConnectionTesterDependencies {
  secrets?: AISecretStoreAdapter;
  outboundPolicy?: OutboundTargetPolicy;
  transport?: AIProviderHttpTransport;
  clock?: () => number;
  timeoutMs?: number;
}

export class AIProviderConnectionError extends Error {
  constructor(readonly code: "PROVIDER_NOT_FOUND" | "CREDENTIAL_MISSING" | "PROVIDER_DISABLED", message: string) {
    super(message);
    this.name = "AIProviderConnectionError";
  }
}

export class AIProviderConnectionTester {
  private readonly providers: SQLiteAIProviderConfigRepository;
  private readonly secrets: AISecretStoreAdapter;
  private readonly outboundPolicy: OutboundTargetPolicy;
  private readonly transport: AIProviderHttpTransport;
  private readonly clock: () => number;
  private readonly timeoutMs: number;

  constructor(private readonly database: ContentDatabase, dependencies: AIProviderConnectionTesterDependencies = {}) {
    this.providers = new SQLiteAIProviderConfigRepository(database);
    this.secrets = dependencies.secrets ?? createLocalAISecretStore(database);
    this.outboundPolicy = dependencies.outboundPolicy ?? createProviderOutboundPolicy();
    this.transport = dependencies.transport ?? new NativeFetchAIProviderHttpTransport();
    this.clock = dependencies.clock ?? Date.now;
    this.timeoutMs = dependencies.timeoutMs ?? AI_PROVIDER_CONNECTION_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 30_000) throw new Error("Provider connection timeout is invalid.");
  }

  async test(providerId: string): Promise<AIProviderConnectionTestResult> {
    const startedAt = this.clock();
    const provider = this.providers.getById(providerId);
    if (!provider) throw new AIProviderConnectionError("PROVIDER_NOT_FOUND", "The selected Provider configuration was not found.");
    if (!provider.enabled) return this.result("UNSUPPORTED", startedAt, null, null, null, [], "PROVIDER_DISABLED");
    if (!provider.credentialRef) return this.result("UNSUPPORTED", startedAt, null, null, null, [], "CREDENTIAL_MISSING");
    const metadata = this.secrets.getMetadata(provider.credentialRef);
    if (!metadata || metadata.status !== "ACTIVE") return this.result("UNSUPPORTED", startedAt, null, null, null, [], "CREDENTIAL_MISSING");

    let target: ValidatedOutboundTarget;
    try {
      target = await this.outboundPolicy.validate(provider.baseUrl);
    } catch {
      return this.result("UNSUPPORTED", startedAt, null, null, null, [], "OUTBOUND_TARGET_REJECTED");
    }

    let secret: string;
    try {
      secret = await this.secrets.resolveVersion({ credentialRef: provider.credentialRef, expectedSecretVersion: metadata.secretVersion });
    } catch {
      return this.result("UNSUPPORTED", startedAt, null, null, null, [], "CREDENTIAL_UNAVAILABLE");
    }

    let response: AIProviderHttpResponse;
    try {
      response = await this.transport.request(target, { method: "GET", pathAndQuery: "models", headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, signal: new AbortController().signal, timeoutMs: this.timeoutMs });
    } catch (error) {
      const code = error instanceof AIProviderConnectionTransportError ? error.code : "UNREACHABLE";
      return this.result(code === "TIMEOUT" ? "TIMEOUT" : code === "RESPONSE_TOO_LARGE" || code === "REDIRECT" ? "UNSUPPORTED" : "UNREACHABLE", startedAt, null, null, null, [], code);
    }

    const latencyMs = boundedLatency(this.clock(), startedAt);
    if (response.status === 401 || response.status === 403) return this.result("AUTH_FAILED", startedAt, latencyMs, response.status, null, [], "AUTH_FAILED");
    if (response.status >= 500 && response.status <= 599) return this.result("PROVIDER_ERROR", startedAt, latencyMs, response.status, null, [], "PROVIDER_ERROR");
    if (response.status < 200 || response.status >= 300) return this.result("UNSUPPORTED", startedAt, latencyMs, response.status, null, [], "MODELS_ENDPOINT_UNSUPPORTED");

    let body: string;
    try { body = await collectBody(response.body); } catch (error) { return this.result("UNSUPPORTED", startedAt, latencyMs, response.status, null, [], error instanceof AIProviderConnectionTransportError ? error.code : "RESPONSE_INVALID"); }
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return this.result("UNSUPPORTED", startedAt, latencyMs, response.status, null, [], "RESPONSE_INVALID_JSON"); }
    const modelIds = parseModelIds(parsed);
    if (modelIds === null) return this.result("UNSUPPORTED", startedAt, latencyMs, response.status, null, [], "MODELS_RESPONSE_UNSUPPORTED");
    return this.result("CONNECTED", startedAt, latencyMs, response.status, modelIds.count, modelIds.ids, "REACHABLE_CREDENTIAL_NOT_PROVEN");
  }

  private result(status: AIProviderConnectionStatus, startedAt: number, latencyMs: number | null, httpStatus: number | null, modelCount: number | null, modelIds: string[], messageCode: string): AIProviderConnectionTestResult {
    return { status, testedAt: this.clock(), latencyMs: latencyMs === null ? null : Math.min(latencyMs, AI_PROVIDER_CONNECTION_TIMEOUT_MS), httpStatus, modelCount, modelIds: modelIds.slice(0, MAX_MODEL_PREVIEW), messageCode, strategy: AI_PROVIDER_CONNECTION_STRATEGY, credentialVerification: status === "AUTH_FAILED" ? "REJECTED" : "NOT_PROVEN" };
  }
}

let testerSingleton: AIProviderConnectionTester | undefined;
export function getAIProviderConnectionTester(): AIProviderConnectionTester {
  testerSingleton ??= new AIProviderConnectionTester(getContentDatabase());
  return testerSingleton;
}

export class NodeDnsAddressResolver {
  async resolve(hostname: string): Promise<readonly string[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  }
}

export class NativeFetchAIProviderHttpTransport implements AIProviderHttpTransport {
  async request(target: ValidatedOutboundTarget, request: AIProviderHttpRequest): Promise<AIProviderHttpResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, request.timeoutMs);
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      const url = buildModelsUrl(target.url, request.pathAndQuery);
      const response = await fetch(url, { method: request.method, headers: request.headers, redirect: "error", signal: controller.signal });
      const bytes = await readResponseBytes(response, AI_PROVIDER_HTTP_LIMITS.maxResponseBodyBytes);
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: singleBody(bytes) };
    } catch (error) {
      if (timedOut) throw new AIProviderConnectionTransportError("TIMEOUT");
      if (error instanceof AIProviderConnectionTransportError) throw error;
      if (error instanceof AIProviderGatewayError && error.code === "CONFIGURATION") throw new AIProviderConnectionTransportError("REDIRECT");
      if (error instanceof Error && error.name === "AbortError") throw new AIProviderConnectionTransportError("TIMEOUT");
      throw new AIProviderConnectionTransportError("UNREACHABLE");
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  }
}

export class AIProviderConnectionTransportError extends Error {
  constructor(readonly code: "TIMEOUT" | "UNREACHABLE" | "RESPONSE_TOO_LARGE" | "REDIRECT") { super(code); this.name = "AIProviderConnectionTransportError"; }
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new AIProviderConnectionTransportError("RESPONSE_TOO_LARGE"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function* singleBody(bytes: Uint8Array): AsyncIterable<Uint8Array> { if (bytes.byteLength) yield bytes; }

function buildModelsUrl(baseUrl: string, pathAndQuery: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const path = pathAndQuery.replace(/^\/+/, "");
  const url = new URL(path, base);
  if (url.protocol !== "https:" && !isLocalOmniRouteUrl(url)) throw new AIProviderGatewayError("CONFIGURATION", "The Provider target is not secure.");
  return url.toString();
}

async function collectBody(body: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) { total += chunk.byteLength; if (total > AI_PROVIDER_HTTP_LIMITS.maxResponseBodyBytes) throw new AIProviderConnectionTransportError("RESPONSE_TOO_LARGE"); chunks.push(chunk); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return Buffer.from(output).toString("utf8");
}

function parseModelIds(value: unknown): { count: number; ids: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const ids: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof (item as { id?: unknown }).id !== "string") return null;
    const id = (item as { id: string }).id.trim();
    if (!id || Buffer.byteLength(id, "utf8") > 240) return null;
    if (ids.length < MAX_MODEL_PREVIEW) ids.push(id);
  }
  return { count: data.length, ids };
}

function boundedLatency(now: number, startedAt: number): number | null {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(startedAt) || now < startedAt || now > MAX_TIMESTAMP) return null;
  return now - startedAt;
}
