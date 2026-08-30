export class ChatQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(chatId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(chatId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(chatId, tail);
    await previous;
    try { return await task(); }
    finally {
      release();
      if (this.tails.get(chatId) === tail) this.tails.delete(chatId);
    }
  }
}
