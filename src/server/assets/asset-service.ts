import { createReadStream } from "node:fs";
import path from "node:path";
import type { AdminActor } from "../admin-auth/contracts";
import type { AssetStorage } from "../content/contracts";
import type {
  Asset,
  AssetInventoryStats,
  AssetIntegrityResult,
  AssetPage,
  AssetRepository,
  AssetWithCreator,
  BrowseAssetsOptions,
  IngestAssetInput,
  IngestAssetResult,
  ListAssetsOptions,
} from "./contracts";
import {
  AssetIntegrityError,
  AssetNotFoundError,
  AssetStorageError,
  AssetValidationError,
} from "./errors";
import { inspectAssetFile } from "./file-inspection";
import { sha256File, sha256Stream } from "./file-hash";
import {
  normalizeAssetDisplayName,
  sanitizeOriginalFilename,
} from "./filename";
import { resolveMaximumAssetBytes } from "./policy";

export interface AssetServiceOptions {
  maximumAssetBytes?: number;
  stagingDirectory: string;
}

export class AssetService {
  private readonly maximumAssetBytes: number;
  private readonly stagingDirectory: string;
  private readonly hashLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: AssetRepository,
    private readonly storage: AssetStorage,
    options: AssetServiceOptions,
  ) {
    this.maximumAssetBytes = options.maximumAssetBytes ?? resolveMaximumAssetBytes();
    this.stagingDirectory = path.resolve(options.stagingDirectory);
  }

  async ingest(input: IngestAssetInput, actor: AdminActor): Promise<IngestAssetResult> {
    this.assertActor(actor);
    this.assertStagedPath(input.filePath);
    const originalFilename = sanitizeOriginalFilename(input.originalFilename);
    const displayName = normalizeAssetDisplayName(input.displayName, originalFilename);
    const inspection = await inspectAssetFile(
      input.filePath,
      originalFilename,
      this.maximumAssetBytes,
    );
    const digest = await sha256File(input.filePath);
    if (digest.byteSize !== inspection.byteSize) {
      throw new AssetValidationError("The staged asset changed during inspection.");
    }

    return this.withHashLock(digest.sha256, async () => {
      const existing = this.repository.findBySha256(digest.sha256);
      if (existing) {
        await this.assertIntegrity(existing);
        return { asset: existing, reused: true };
      }

      const stored = await this.storage.putStream(createReadStream(input.filePath));
      if (
        stored.sha256 !== digest.sha256 ||
        stored.byteSize !== inspection.byteSize
      ) {
        if (stored.created) await this.storage.delete(stored.storageKey);
        throw new AssetValidationError("The staged asset changed during storage.");
      }

      try {
        const asset = this.repository.create({
          originalFilename,
          displayName,
          mimeType: inspection.mimeType,
          mediaKind: inspection.mediaKind,
          byteSize: inspection.byteSize,
          sha256: stored.sha256,
          storageKey: stored.storageKey,
          width: inspection.width,
          height: inspection.height,
          durationMs: inspection.durationMs,
          actor,
        });
        return { asset, reused: false };
      } catch (error) {
        let concurrentlyCreated: Asset | null;
        try {
          concurrentlyCreated = this.repository.findBySha256(stored.sha256);
        } catch {
          if (stored.created) await this.storage.delete(stored.storageKey);
          throw error;
        }
        if (concurrentlyCreated) {
          await this.assertIntegrity(concurrentlyCreated);
          return { asset: concurrentlyCreated, reused: true };
        }

        if (stored.created) await this.storage.delete(stored.storageKey);
        throw error;
      }
    });
  }

  async inspectStagedDigest(filePath: string): Promise<{ sha256: string; byteSize: number }> {
    this.assertStagedPath(filePath);
    return sha256File(filePath);
  }

  getById(id: string): Asset {
    const asset = this.repository.findById(id);
    if (!asset) throw new AssetNotFoundError(id);
    return asset;
  }

  getByIdWithCreator(id: string): AssetWithCreator {
    const record = this.repository.findByIdWithCreator(id);
    if (!record) throw new AssetNotFoundError(id);
    return record;
  }

  list(options: ListAssetsOptions = {}): Asset[] {
    return this.repository.list(options);
  }

  listAll(): Asset[] {
    return this.repository.listAll();
  }

  browse(options: BrowseAssetsOptions = {}): AssetPage {
    return this.repository.browse(options);
  }

  getInventoryStats(): AssetInventoryStats {
    return this.repository.getInventoryStats();
  }

  updateDisplayName(
    id: string,
    displayName: string,
    expectedRevision: number,
    actor: AdminActor,
  ): Asset {
    this.assertActor(actor);
    return this.repository.updateMetadata({
      id,
      displayName: normalizeAssetDisplayName(displayName, displayName),
      expectedRevision,
      actor,
    });
  }

  async verifyIntegrity(assetOrId: Asset | string): Promise<AssetIntegrityResult> {
    const asset = typeof assetOrId === "string" ? this.getById(assetOrId) : assetOrId;
    if (!(await this.storage.exists(asset.storageKey))) {
      return {
        assetId: asset.id,
        ok: false,
        status: "missing",
        expectedSha256: asset.sha256,
        actualSha256: null,
        expectedByteSize: asset.byteSize,
        actualByteSize: null,
      };
    }

    const actual = await sha256Stream(await this.storage.openReadStream(asset.storageKey));
    const status =
      actual.byteSize !== asset.byteSize
        ? "size-mismatch"
        : actual.sha256 !== asset.sha256
          ? "hash-mismatch"
          : "ok";
    return {
      assetId: asset.id,
      ok: status === "ok",
      status,
      expectedSha256: asset.sha256,
      actualSha256: actual.sha256,
      expectedByteSize: asset.byteSize,
      actualByteSize: actual.byteSize,
    };
  }

  async hasStoredObject(assetOrId: Asset | string): Promise<boolean> {
    const asset = typeof assetOrId === "string" ? this.getById(assetOrId) : assetOrId;
    return this.storage.exists(asset.storageKey);
  }

  async delete(
    id: string,
    expectedRevision: number,
    actor: AdminActor,
  ): Promise<{ asset: Asset; storageCleanup: "complete" | "pending" }> {
    this.assertActor(actor);
    const asset = this.repository.delete({ id, expectedRevision, actor });
    try {
      await this.storage.delete(asset.storageKey);
      return { asset, storageCleanup: "complete" };
    } catch (error) {
      // The metadata row is already gone, so retaining the content-addressed
      // object is an orphan-safe cleanup concern rather than a broken Asset.
      if (error instanceof AssetStorageError) {
        return { asset, storageCleanup: "pending" };
      }
      return { asset, storageCleanup: "pending" };
    }
  }

  async openContent(id: string): Promise<{
    asset: Asset;
    body: ReadableStream<Uint8Array>;
  }> {
    const asset = this.getById(id);
    await this.assertIntegrity(asset);
    return {
      asset,
      body: await this.storage.openReadStream(asset.storageKey),
    };
  }

  private async assertIntegrity(asset: Asset): Promise<void> {
    const integrity = await this.verifyIntegrity(asset);
    if (!integrity.ok) throw new AssetIntegrityError(asset.id);
  }

  private assertActor(actor: AdminActor): void {
    if (
      !actor.actorUserId?.trim() ||
      (actor.actorRole !== "OWNER" && actor.actorRole !== "ADMIN")
    ) {
      throw new AssetValidationError("A valid authenticated admin actor is required.");
    }
  }

  private assertStagedPath(filePath: string): void {
    const stagedPath = path.resolve(filePath);
    const relative = path.relative(this.stagingDirectory, stagedPath);
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new AssetValidationError("The asset file is outside the trusted staging area.");
    }
  }

  private async withHashLock<T>(sha256: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.hashLocks.get(sha256) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.hashLocks.set(sha256, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.hashLocks.get(sha256) === tail) this.hashLocks.delete(sha256);
    }
  }
}
