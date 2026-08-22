import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import type { AssetMediaKind } from "./contracts";
import {
  AssetTooLargeError,
  AssetUnsupportedTypeError,
  AssetValidationError,
} from "./errors";
import { getAssetFilenameExtension } from "./filename";
import { MAX_JSON_INSPECTION_BYTES } from "./policy";

const DANGEROUS_EXTENSIONS = new Set([
  ".apk",
  ".bat",
  ".cjs",
  ".cmd",
  ".com",
  ".dll",
  ".exe",
  ".htm",
  ".html",
  ".jar",
  ".js",
  ".jsx",
  ".mjs",
  ".msi",
  ".ps1",
  ".scr",
  ".sh",
  ".svg",
  ".ts",
  ".tsx",
  ".wasm",
  ".xhtml",
  ".xml",
]);

const DANGEROUS_MIME_TYPES = new Set([
  "application/java-archive",
  "application/javascript",
  "application/vnd.android.package-archive",
  "application/wasm",
  "application/x-dosexec",
  "application/x-elf",
  "application/x-executable",
  "application/x-mach-binary",
  "application/x-msdownload",
  "application/x-sharedlib",
  "application/x-shockwave-flash",
  "image/svg+xml",
  "text/html",
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/epub+zip",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

const ACTIVE_MARKUP_PREFIX = /^(?:<!doctype\s+html|<html\b|<script\b|<svg\b|<\?xml\b)/iu;
const MAX_IMAGE_PIXELS = 100_000_000;

export interface InspectedAssetFile {
  byteSize: number;
  mimeType: string;
  mediaKind: AssetMediaKind;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

async function readAndValidateUtf8(filePath: string): Promise<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let prefix = "";
  try {
    for await (const chunk of createReadStream(filePath)) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (bytes.includes(0)) throw new AssetUnsupportedTypeError();
      const text = decoder.decode(bytes, { stream: true });
      if (prefix.length < 4096) prefix += text.slice(0, 4096 - prefix.length);
    }
    decoder.decode();
  } catch (error) {
    if (error instanceof AssetUnsupportedTypeError) throw error;
    throw new AssetUnsupportedTypeError();
  }
  if (ACTIVE_MARKUP_PREFIX.test(prefix.replace(/^\uFEFF/u, "").trimStart())) {
    throw new AssetUnsupportedTypeError();
  }
  return prefix;
}

async function inspectJson(filePath: string, byteSize: number): Promise<void> {
  if (byteSize > MAX_JSON_INSPECTION_BYTES) {
    throw new AssetValidationError(
      `JSON inspection is limited to ${MAX_JSON_INSPECTION_BYTES} bytes.`,
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(filePath));
    JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch {
    throw new AssetValidationError("The JSON asset is not valid UTF-8 JSON.");
  }
}

function classifyMimeType(mimeType: string): AssetMediaKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (DOCUMENT_MIME_TYPES.has(mimeType)) return "document";
  return "other-safe-file";
}

export async function inspectAssetFile(
  filePath: string,
  originalFilename: string,
  maximumBytes: number,
): Promise<InspectedAssetFile> {
  const file = await lstat(filePath);
  if (!file.isFile() || file.isSymbolicLink() || file.size <= 0) {
    throw new AssetValidationError("The uploaded asset must be a non-empty regular file.");
  }
  if (file.size > maximumBytes) throw new AssetTooLargeError(maximumBytes);

  const extension = getAssetFilenameExtension(originalFilename);
  if (DANGEROUS_EXTENSIONS.has(extension)) throw new AssetUnsupportedTypeError();

  const detected = await fileTypeFromFile(filePath);
  if (detected && DANGEROUS_MIME_TYPES.has(detected.mime)) {
    throw new AssetUnsupportedTypeError();
  }

  let mimeType: string;
  let mediaKind: AssetMediaKind;
  let width: number | null = null;
  let height: number | null = null;

  if (detected) {
    mimeType = detected.mime;
    mediaKind = classifyMimeType(mimeType);
  } else {
    await readAndValidateUtf8(filePath);
    if (extension === ".json") {
      await inspectJson(filePath, file.size);
      mimeType = "application/json";
      mediaKind = "json";
    } else {
      mimeType = "text/plain; charset=utf-8";
      mediaKind = "other-safe-file";
    }
  }

  if (mediaKind === "image") {
    try {
      const metadata = await sharp(filePath, {
        failOn: "error",
        limitInputPixels: MAX_IMAGE_PIXELS,
      }).metadata();
      if (!metadata.width || !metadata.height) throw new Error("Missing dimensions");
      width = metadata.width;
      height = metadata.height;
    } catch (error) {
      throw new AssetValidationError("The raster image could not be validated.", error);
    }
  }

  return {
    byteSize: file.size,
    mimeType,
    mediaKind,
    width,
    height,
    durationMs: null,
  };
}
