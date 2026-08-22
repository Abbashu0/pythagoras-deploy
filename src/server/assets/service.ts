import { getContentDatabase, type ContentDatabase } from "../content/database";
import { AssetService } from "./asset-service";
import { LocalFileAssetStorage } from "./local-file-asset-storage";
import { SQLiteAssetRepository } from "./sqlite-asset-repository";

export function createAssetService(database: ContentDatabase): AssetService {
  return new AssetService(
    new SQLiteAssetRepository(database),
    new LocalFileAssetStorage(database.paths.objectStorageDirectory),
    { stagingDirectory: database.paths.tempDirectory },
  );
}

type AssetServiceGlobal = typeof globalThis & {
  __pythagorasAssetService?: AssetService;
};

export function getAssetService(): AssetService {
  const assetGlobal = globalThis as AssetServiceGlobal;
  if (!assetGlobal.__pythagorasAssetService) {
    assetGlobal.__pythagorasAssetService = createAssetService(getContentDatabase());
  }
  return assetGlobal.__pythagorasAssetService;
}
