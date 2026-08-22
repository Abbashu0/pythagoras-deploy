import { AssetValidationError } from "./errors";

export const PYTHAGORAS_MAX_ASSET_BYTES_ENV = "PYTHAGORAS_MAX_ASSET_BYTES";
export const DEFAULT_MAX_ASSET_BYTES = 100 * 1024 * 1024;
export const ABSOLUTE_MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_ASSET_FILENAME_LENGTH = 255;
export const MAX_ASSET_DISPLAY_NAME_LENGTH = 255;
export const MAX_JSON_INSPECTION_BYTES = 16 * 1024 * 1024;

export interface AssetSizePolicyOptions {
  env?: Readonly<Record<string, string | undefined>>;
}

export function resolveMaximumAssetBytes(
  options: AssetSizePolicyOptions = {},
): number {
  const configured = (options.env ?? process.env)[PYTHAGORAS_MAX_ASSET_BYTES_ENV]?.trim();
  if (!configured) return DEFAULT_MAX_ASSET_BYTES;

  if (!/^[1-9][0-9]*$/u.test(configured)) {
    throw new AssetValidationError(
      `${PYTHAGORAS_MAX_ASSET_BYTES_ENV} must be a positive integer.`,
    );
  }

  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value > ABSOLUTE_MAX_ASSET_BYTES) {
    throw new AssetValidationError(
      `${PYTHAGORAS_MAX_ASSET_BYTES_ENV} must not exceed ${ABSOLUTE_MAX_ASSET_BYTES}.`,
    );
  }
  return value;
}
