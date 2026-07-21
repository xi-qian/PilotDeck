/**
 * Minimal single-producer-multi-(or single-)consumer FIFO queue with an
 * async iterator surface. Used by `InProcessGateway.submitTurn` to fan-in
 * events from two sources:
 *   1. The agent session's event stream (mapped through `mapAgentEvent`).
 *   2. The elicitation channel's downstream emits (B1).
 *
 * Closing the queue terminates the iterator; pending `dequeue()` resolves
 * to `{ done: true }`. Pushing after close is a no-op.
 */
export type AsyncQueueOptions<T> = {
  maxItems?: number;
  maxBytes?: number;
  sizeOf?: (value: T) => number;
  onOverflow?: () => void;
};

export class AsyncQueue<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<{ resolve(value: IteratorResult<T>): void }> = [];
  private closed = false;
  private error: Error | undefined;
  private bufferedBytes = 0;

  constructor(private readonly options: AsyncQueueOptions<T> = {}) {}

  enqueue(value: T): void {
    if (this.closed) return;
    if (this.waiters.length > 0) {
      this.waiters.shift()!.resolve({ value, done: false });
      return;
    }
    const itemBytes = this.options.sizeOf?.(value) ?? 0;
    if (
      (this.options.maxItems !== undefined && this.buffer.length >= this.options.maxItems) ||
      (this.options.maxBytes !== undefined && this.bufferedBytes + itemBytes > this.options.maxBytes)
    ) {
      this.options.onOverflow?.();
      this.fail(new Error("AsyncQueue capacity exceeded."));
      return;
    }
    this.buffer.push(value);
    this.bufferedBytes += itemBytes;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!.resolve({ value: undefined as unknown as T, done: true });
    }
  }

  fail(error: Error): void {
    this.error = error;
    this.close();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.error) {
          const err = this.error;
          this.error = undefined;
          return Promise.reject(err);
        }
        if (this.buffer.length > 0) {
          const value = this.buffer.shift()!;
          this.bufferedBytes -= this.options.sizeOf?.(value) ?? 0;
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push({ resolve });
        });
      },
    };
  }
}
