export interface EnqueueMemoryBackupInput {
  memoryId: string;
  contentPath: string;
}

export interface EnqueueMemoryBackupResult {
  backupStatus: "pending" | "queued";
}

export interface MemoryBackupQueue {
  enqueue: (
    input: EnqueueMemoryBackupInput,
  ) => Promise<EnqueueMemoryBackupResult>;
}

export function createNoopMemoryBackupQueue(): MemoryBackupQueue {
  return {
    enqueue: async () => ({ backupStatus: "pending" }),
  };
}
