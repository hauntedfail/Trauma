export function getMemoryReaderStatusCode(memory: { id: string } | undefined): 404 | undefined {
  return memory === undefined ? 404 : undefined;
}
