export const MEMORY_OPERATION_JOURNAL_DIRECTORY = ".operations";
export const MEMORY_DELETE_STAGING_DIRECTORY = ".delete-staging";

const INTERNAL_STORE_DIRECTORIES = new Set([
  MEMORY_DELETE_STAGING_DIRECTORY,
  MEMORY_OPERATION_JOURNAL_DIRECTORY,
]);

export function isInternalBackupStorePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const [rootSegment] = normalized.split("/");
  return rootSegment !== undefined && INTERNAL_STORE_DIRECTORIES.has(rootSegment);
}
