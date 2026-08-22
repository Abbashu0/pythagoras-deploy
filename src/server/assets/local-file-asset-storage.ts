import { createHash, randomBytes } from "node:crypto";
import {
  access,
  link,
  mkdir,
  open,
  readFile,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { AssetStorage, StoredAssetObject } from "../content/contracts";
import { AssetStorageError, AssetValidationError } from "./errors";

const STORAGE_KEY_PATTERN = /^([0-9a-f]{2})\/([0-9a-f]{64})$/u;

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    String((error as Error & { code?: unknown }).code) === code
  );
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    if (result.bytesWritten <= 0) {
      throw new AssetStorageError("The asset staging write did not make progress.");
    }
    offset += result.bytesWritten;
  }
}

async function hashFile(filePath: string): Promise<{ sha256: string; byteSize: number }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    hash.update(bytes);
    byteSize += bytes.byteLength;
  }
  return { sha256: hash.digest("hex"), byteSize };
}

export class LocalFileAssetStorage implements AssetStorage {
  readonly rootDirectory: string;
  private readonly incomingDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.incomingDirectory = path.join(this.rootDirectory, ".incoming");
  }

  async put(bytes: Uint8Array): Promise<StoredAssetObject> {
    return this.putStream(
      (async function* source() {
        yield bytes;
      })(),
    );
  }

  async putStream(source: AsyncIterable<Uint8Array>): Promise<StoredAssetObject> {
    await mkdir(this.incomingDirectory, { recursive: true });
    const temporaryPath = path.join(
      this.incomingDirectory,
      `${randomBytes(18).toString("hex")}.tmp`,
    );
    const hash = createHash("sha256");
    let byteSize = 0;
    let handle: FileHandle | null = null;

    try {
      handle = await open(temporaryPath, "wx", 0o600);
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array)) {
          throw new AssetValidationError("Asset storage accepts binary chunks only.");
        }
        if (chunk.byteLength === 0) continue;
        await writeAll(handle, chunk);
        hash.update(chunk);
        byteSize += chunk.byteLength;
      }
      await handle.sync();
      await handle.close();
      handle = null;

      const sha256 = hash.digest("hex");
      const storageKey = `${sha256.slice(0, 2)}/${sha256}`;
      const finalPath = this.resolveStoragePath(storageKey);
      await mkdir(path.dirname(finalPath), { recursive: true });

      let created = false;
      try {
        await link(temporaryPath, finalPath);
        created = true;
      } catch (error) {
        if (!isFileSystemError(error, "EEXIST")) throw error;
        const existing = await hashFile(finalPath);
        if (existing.sha256 !== sha256 || existing.byteSize !== byteSize) {
          throw new AssetStorageError(
            "An existing content-addressed object failed collision verification.",
          );
        }
      }

      await unlink(temporaryPath);
      return { storageKey, sha256, byteSize, created };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      await unlink(temporaryPath).catch(() => undefined);
      if (error instanceof AssetStorageError || error instanceof AssetValidationError) {
        throw error;
      }
      throw new AssetStorageError(undefined, error);
    }
  }

  async read(storageKey: string): Promise<Uint8Array> {
    try {
      return await readFile(this.resolveStoragePath(storageKey));
    } catch (error) {
      throw new AssetStorageError("The asset object could not be read.", error);
    }
  }

  async openReadStream(storageKey: string): Promise<ReadableStream<Uint8Array>> {
    const objectPath = this.resolveStoragePath(storageKey);
    try {
      await access(objectPath);
      return Readable.toWeb(createReadStream(objectPath)) as ReadableStream<Uint8Array>;
    } catch (error) {
      throw new AssetStorageError("The asset object could not be opened.", error);
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const object = await stat(this.resolveStoragePath(storageKey));
      return object.isFile();
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) return false;
      throw new AssetStorageError("The asset object could not be inspected.", error);
    }
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.resolveStoragePath(storageKey));
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) return;
      throw new AssetStorageError("The asset object could not be removed.", error);
    }
  }

  private resolveStoragePath(storageKey: string): string {
    const match = STORAGE_KEY_PATTERN.exec(storageKey);
    if (!match || match[1] !== match[2]?.slice(0, 2)) {
      throw new AssetValidationError("The asset storage key is invalid.");
    }
    return path.join(this.rootDirectory, match[1], match[2]);
  }
}
