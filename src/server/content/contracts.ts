import type { ContentPayload } from "./schema";

export interface ContentRecord<TPayload extends ContentPayload = ContentPayload> {
  id: string;
  resourceType: string;
  resourceKey: string;
  payload: TPayload;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContentRecord<TPayload extends ContentPayload = ContentPayload> {
  id?: string;
  resourceType: string;
  resourceKey: string;
  payload: TPayload;
}

export interface UpdateContentRecord<TPayload extends ContentPayload = ContentPayload> {
  id: string;
  expectedRevision: number;
  payload: TPayload;
}

export interface ContentRepository {
  create<TPayload extends ContentPayload>(
    input: CreateContentRecord<TPayload>,
  ): ContentRecord<TPayload>;
  findById<TPayload extends ContentPayload = ContentPayload>(
    id: string,
  ): ContentRecord<TPayload> | null;
  findByKey<TPayload extends ContentPayload = ContentPayload>(
    resourceType: string,
    resourceKey: string,
  ): ContentRecord<TPayload> | null;
  listByType<TPayload extends ContentPayload = ContentPayload>(
    resourceType: string,
  ): ContentRecord<TPayload>[];
  update<TPayload extends ContentPayload>(
    input: UpdateContentRecord<TPayload>,
  ): ContentRecord<TPayload>;
  delete(id: string, expectedRevision: number): void;
}

export interface StoredAssetObject {
  storageKey: string;
  sha256: string;
  byteSize: number;
  created: boolean;
}

export interface AssetStorage {
  put(bytes: Uint8Array): Promise<StoredAssetObject>;
  putStream(source: AsyncIterable<Uint8Array>): Promise<StoredAssetObject>;
  read(storageKey: string): Promise<Uint8Array>;
  openReadStream(storageKey: string): Promise<ReadableStream<Uint8Array>>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<void>;
}

export interface SearchProvider<TQuery, TResult> {
  search(query: TQuery): Promise<readonly TResult[]>;
}
