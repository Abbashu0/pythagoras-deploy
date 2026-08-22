import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy, { type BusboyFileStream } from "@fastify/busboy";
import { AssetTooLargeError, AssetUploadError } from "./errors";

const MAX_DISPLAY_NAME_FIELD_BYTES = 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export interface ParsedAssetUpload {
  filePath: string;
  originalFilename: string;
  displayName?: string;
}

export async function removeParsedAssetUpload(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

export async function parseAssetUpload(
  request: Request,
  stagingRoot: string,
  maximumBytes: number,
): Promise<ParsedAssetUpload> {
  const contentType = request.headers.get("content-type")?.trim();
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new AssetUploadError("A multipart/form-data upload is required.");
  }
  if (!request.body) throw new AssetUploadError("The upload body is missing.");

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new AssetUploadError();
    if (length > maximumBytes + MAX_MULTIPART_OVERHEAD_BYTES) {
      throw new AssetTooLargeError(maximumBytes);
    }
  }

  const uploadDirectory = path.join(path.resolve(stagingRoot), "uploads");
  await mkdir(uploadDirectory, { recursive: true });
  const filePath = path.join(
    uploadDirectory,
    `${randomBytes(18).toString("hex")}.upload`,
  );
  const source = Readable.from(
    (async function* readWebBody() {
      const reader = request.body!.getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          yield result.value;
        }
      } finally {
        reader.releaseLock();
      }
    })(),
  );

  return new Promise<ParsedAssetUpload>((resolve, reject) => {
    const parser = new Busboy({
      headers: { "content-type": contentType },
      preservePath: false,
      limits: {
        fieldNameSize: 64,
        fieldSize: MAX_DISPLAY_NAME_FIELD_BYTES,
        fields: 1,
        fileSize: maximumBytes,
        files: 1,
        parts: 2,
        headerPairs: 50,
        headerSize: 16 * 1024,
      },
    });
    let originalFilename = "";
    let displayName: string | undefined;
    let fileWrite: Promise<void> | null = null;
    let fileStream: BusboyFileStream | null = null;
    let uploadError: Error | null = null;
    let settled = false;

    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      source.destroy();
      parser.destroy();
      void (async () => {
        await fileWrite?.catch(() => undefined);
        await removeParsedAssetUpload(filePath);
        reject(error);
      })();
    };

    parser.on("file", (fieldName, stream, filename) => {
      if (fieldName !== "file" || fileWrite) {
        uploadError = new AssetUploadError("Exactly one file field named file is required.");
        stream.resume();
        return;
      }
      fileStream = stream;
      originalFilename = filename;
      stream.once("limit", () => {
        uploadError = new AssetTooLargeError(maximumBytes);
      });
      fileWrite = pipeline(
        stream,
        createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
      );
      fileWrite.catch((error: unknown) => {
        finishWithError(new AssetUploadError("The upload could not be staged.", error));
      });
    });

    parser.on("field", (fieldName, value, _nameTruncated, valueTruncated) => {
      if (fieldName !== "displayName" || displayName !== undefined || valueTruncated) {
        uploadError = new AssetUploadError("The upload fields are invalid.");
        return;
      }
      displayName = value;
    });

    parser.on("filesLimit", () => {
      uploadError = new AssetUploadError("Only one asset file is accepted.");
    });
    parser.on("fieldsLimit", () => {
      uploadError = new AssetUploadError("Too many upload fields were supplied.");
    });
    parser.on("partsLimit", () => {
      uploadError = new AssetUploadError("Too many multipart sections were supplied.");
    });
    parser.on("error", (error) => {
      finishWithError(new AssetUploadError("The multipart upload is malformed.", error));
    });
    source.on("error", (error) => {
      finishWithError(new AssetUploadError("The upload stream failed.", error));
    });

    parser.on("finish", () => {
      void (async () => {
        try {
          await fileWrite;
          if (settled) return;
          if (uploadError) throw uploadError;
          if (!fileWrite || !fileStream || fileStream.truncated || !originalFilename) {
            throw new AssetUploadError("Exactly one non-empty file is required.");
          }
          settled = true;
          resolve({ filePath, originalFilename, displayName });
        } catch (error) {
          finishWithError(
            error instanceof Error ? error : new AssetUploadError(),
          );
        }
      })();
    });

    source.pipe(parser);
  });
}
