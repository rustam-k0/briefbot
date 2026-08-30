export async function withRetry<T>(operation: () => Promise<T>, options: { attempts?: number; baseDelayMs?: number; retryIf?: (error: unknown) => boolean } = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= attempts - 1 || options.retryIf?.(error) === false) throw error;
      const base=(options.baseDelayMs ?? 200)*2**attempt;
      await new Promise((resolve) => setTimeout(resolve, base+Math.floor(Math.random()*Math.max(1,base*.25))));
    }
  }
}
