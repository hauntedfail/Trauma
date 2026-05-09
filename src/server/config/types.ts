export interface GitBackupConfig {
  enabled: boolean;
  remote: string;
  branch: string;
  push: boolean;
  commitMessageTemplate: string;
}

export interface TraumaConfig {
  storePath: string;
  projectPath: string;
  databasePath: string;
  backup: {
    git: GitBackupConfig;
  };
}

export interface ResolvedTraumaConfig {
  configFilePath: string;
  storePath: string;
  projectPath: string;
  databasePath: string;
  backup: TraumaConfig["backup"];
}

export type ConfigValidationResult =
  | { ok: true; config: ResolvedTraumaConfig }
  | { ok: false; errors: string[] };

export interface LoadTraumaConfigOptions {
  configPath?: string;
  cwd?: string;
}
