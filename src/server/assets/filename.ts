import path from "node:path";
import {
  MAX_ASSET_DISPLAY_NAME_LENGTH,
  MAX_ASSET_FILENAME_LENGTH,
} from "./policy";
import { AssetValidationError } from "./errors";

const CONTROL_AND_DIRECTIONAL_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const WINDOWS_RESERVED_CHARACTERS = /[<>:"|?*]/gu;
const WINDOWS_RESERVED_BASENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

export function sanitizeOriginalFilename(value: string): string {
  if (typeof value !== "string") throw new AssetValidationError();
  const normalized = value.normalize("NFKC");
  const basename = normalized.split(/[\\/]/u).at(-1) ?? "";
  let safe = basename
    .replace(CONTROL_AND_DIRECTIONAL_CHARACTERS, "")
    .replace(WINDOWS_RESERVED_CHARACTERS, "-")
    .replace(/[. ]+$/gu, "")
    .trim();

  if (WINDOWS_RESERVED_BASENAME.test(safe)) safe = `_${safe}`;
  safe = truncateCodePoints(safe, MAX_ASSET_FILENAME_LENGTH).replace(/[. ]+$/gu, "");
  if (!safe || safe === "." || safe === "..") {
    throw new AssetValidationError("The original filename is invalid.");
  }
  return safe;
}

export function normalizeAssetDisplayName(
  value: string | undefined,
  fallbackFilename: string,
): string {
  const source = value === undefined ? fallbackFilename : value;
  if (typeof source !== "string") throw new AssetValidationError();
  const normalized = source
    .normalize("NFKC")
    .replace(CONTROL_AND_DIRECTIONAL_CHARACTERS, "")
    .trim();
  const displayName = truncateCodePoints(normalized, MAX_ASSET_DISPLAY_NAME_LENGTH);
  if (!displayName) throw new AssetValidationError("The asset display name is required.");
  return displayName;
}

export function getAssetFilenameExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}
