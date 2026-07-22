import test from 'node:test';
import assert from 'node:assert/strict';

import { SnippetService } from '../src/snippet-service.js';

class MemoryStore {
  constructor(initial = []) {
    this.records = structuredClone(initial);
    this.saveCount = 0;
  }

  async load() { return structuredClone(this.records); }
  async save(records) { this.records = structuredClone(records); this.saveCount += 1; }
}

class FakeEmbedder {
  async embed(text) {
    const length = text.length || 1;
    return [1, length / length];
  }
}

function createService(store = new MemoryStore()) {
  let tick = 0;
  return new SnippetService({
    store,
    embedder: new FakeEmbedder(),
    newId: () => 'snippet-id',
    now: () => `2026-01-01T00:00:0${tick++}.000Z`
  });
}

test('adds normalized snippets and persists them before resolving', async () => {
  const store = new MemoryStore();
  const service = createService(store);

  const snippet = await service.add({ code: 'const answer = 42;', tags: [' JavaScript ', 'javascript', 'utility'], language: 'javascript', description: 'Returns the answer' });

  assert.deepEqual(snippet.tags, ['javascript', 'utility']);
  assert.equal('embedding' in snippet, false);
  assert.equal(store.saveCount, 1);
  assert.equal(store.records[0].embedding.length, 2);
});

test('re-embeds when only the language changes', async () => {
  const store = new MemoryStore([{ id: 'one', code: 'print(1)', tags: [], language: 'python', description: '', embedding: [0, 1], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]);
  const updated = await createService(store).update('one', { language: 'text' });

  assert.equal(updated.language, 'text');
  assert.deepEqual(store.records[0].embedding, [1, 1]);
});

test('filters and ranks results without exposing embeddings', async () => {
  const store = new MemoryStore([
    { id: 'one', code: 'fetch(url)', tags: ['http'], language: 'javascript', description: 'HTTP request', embedding: [1, 1], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'two', code: 'print(1)', tags: ['cli'], language: 'python', description: 'Console output', embedding: [1, 1], createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }
  ]);
  const results = await createService(store).search({ query: 'HTTP request', language: 'javascript' });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'one');
  assert.equal('embedding' in results[0], false);
});

test('rejects invalid updates and invalid search limits', async () => {
  const service = createService();
  await assert.rejects(() => service.update('missing', {}), /at least one/);
  await assert.rejects(() => service.search({ limit: 0 }), /between 1 and/);
});
