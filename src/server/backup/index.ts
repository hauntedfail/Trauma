export interface EnqueueMemoryBackupInput {
  memoryId: string;
  contentPath: string;
}

export interface MemoryBackupQueue {
  enqueue: (input: EnqueueMemoryBackupInput) => Promise<void>;
}

export function createNoopMemoryBackupQueue(): MemoryBackupQueue {
  return {
    enqueue: async () => undefined,
  };
}
