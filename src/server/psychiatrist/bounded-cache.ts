export class BoundedCache<Key, Value> {
  readonly #entries = new Map<Key, Value>();

  constructor(readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("BoundedCache maxEntries must be a positive integer.");
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: Key): Value | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: Key, value: Value): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.#entries.delete(oldestKey);
    }
  }
}
