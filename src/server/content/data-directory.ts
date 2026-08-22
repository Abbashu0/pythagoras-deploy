import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const PYTHAGORAS_DATA_DIR_ENV = "PYTHAGORAS_DATA_DIR";

export interface PythagorasDataPaths {
  root: string;
  databaseDirectory: string;
  databaseFile: string;
  storageDirectory: string;
  objectStorageDirectory: string;
  exportsDirectory: string;
  backupsDirectory: string;
  tempDirectory: string;
  logsDirectory: string;
}

interface ResolveDataDirectoryOptions {
  env?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}

export function resolvePythagorasDataDirectory(
  options: ResolveDataDirectoryOptions = {},
): string {
  const env = options.env ?? process.env;
  const configured = env[PYTHAGORAS_DATA_DIR_ENV]?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  const platform = options.platform ?? process.platform;
  const localAppData = platform === "win32" ? env.LOCALAPPDATA?.trim() : undefined;

  if (localAppData) {
    return path.join(path.resolve(localAppData), "Pythagoras", "data");
  }

  const homeDirectory = options.homeDirectory ?? os.homedir();
  return path.join(path.resolve(homeDirectory), ".pythagoras", "data");
}

export function getPythagorasDataPaths(rootDirectory: string): PythagorasDataPaths {
  const root = path.resolve(rootDirectory);
  const databaseDirectory = path.join(root, "db");
  const storageDirectory = path.join(root, "storage");

  return {
    root,
    databaseDirectory,
    databaseFile: path.join(databaseDirectory, "pythagoras.sqlite"),
    storageDirectory,
    objectStorageDirectory: path.join(storageDirectory, "objects"),
    exportsDirectory: path.join(root, "exports"),
    backupsDirectory: path.join(root, "backups"),
    tempDirectory: path.join(root, "temp"),
    logsDirectory: path.join(root, "logs"),
  };
}

export function ensurePythagorasDataDirectories(
  rootDirectory = resolvePythagorasDataDirectory(),
): PythagorasDataPaths {
  const paths = getPythagorasDataPaths(rootDirectory);
  const directories = [
    paths.root,
    paths.databaseDirectory,
    paths.objectStorageDirectory,
    paths.exportsDirectory,
    paths.backupsDirectory,
    paths.tempDirectory,
    paths.logsDirectory,
  ];

  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
  }

  return paths;
}
