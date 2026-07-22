import fs from 'node:fs/promises';
import path from 'node:path';

/** A small, durable JSON store for snippet records. */
export class JsonSnippetStore {
  #filePath;
  #writeQueue = Promise.resolve();

  constructor(filePath) {
    this.#filePath = filePath;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.#filePath, 'utf8');
      const snippets = JSON.parse(raw);
      if (!Array.isArray(snippets)) {
        throw new Error('The database must contain a JSON array.');
      }
      return snippets;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      if (error instanceof SyntaxError) {
        throw new Error(`Could not parse snippet database at ${this.#filePath}: ${error.message}`);
      }
      throw error;
    }
  }

  save(snippets) {
    const snapshot = JSON.stringify(snippets, null, 2);
    const write = async () => {
      await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
      const tempPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, snapshot, 'utf8');
      await fs.rename(tempPath, this.#filePath);
    };

    // Keep the queue usable after a failed write so a later retry can succeed.
    this.#writeQueue = this.#writeQueue.catch(() => undefined).then(write);
    return this.#writeQueue;
  }
}
