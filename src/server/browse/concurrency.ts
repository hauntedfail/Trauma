export async function mapWithConcurrency<T, Result>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive safe integer");
  }

  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index] as T;
      results[index] = await work(item, index);
    }
  });
  const settledWorkers = await Promise.allSettled(workers);
  const failedWorker = settledWorkers.find(
    (worker): worker is PromiseRejectedResult => worker.status === "rejected",
  );
  if (failedWorker !== undefined) {
    throw failedWorker.reason;
  }

  return results;
}
