import crypto from 'node:crypto';
import hljs from 'highlight.js';

import { DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT, MIN_SCORE } from './constants.js';

const normalize = (value) => value.toLowerCase().replace(/[^\w\s_-]/g, '');
const normalizeTags = (tags) => {
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
    throw new TypeError('Tags must be an array of strings.');
  }
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
};

const asNonEmptyString = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value;
};

const asOptionalString = (value, field) => {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  return value;
};

const embeddingText = ({ description, tags, language, code }) => [
  description,
  `Tags: ${tags.join(', ')}`,
  `Language: ${language}`,
  code
].filter(Boolean).join('\n\n');

const withoutEmbedding = ({ embedding, ...snippet }) => snippet;

function keywordScore(text, query) {
  const tokens = normalize(query).split(/\s+/).filter((token) => token.length > 2);
  if (!tokens.length) return 0;
  const haystack = normalize(text);
  return tokens.reduce((score, token) => {
    const matches = haystack.split(token).length - 1;
    return score + Math.min(matches / tokens.length, 1);
  }, 0) / tokens.length;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return null;
  return a.reduce((total, value, index) => total + value * b[index], 0);
}

function detectLanguage(code) {
  return hljs.highlightAuto(code).language ?? 'plaintext';
}

/** Coordinates validation, embedding generation, search, and persistence. */
export class SnippetService {
  #store;
  #embedder;
  #snippets;
  #loadPromise;
  #mutationQueue = Promise.resolve();
  #now;
  #newId;

  constructor({ store, embedder, now = () => new Date().toISOString(), newId = crypto.randomUUID }) {
    this.#store = store;
    this.#embedder = embedder;
    this.#now = now;
    this.#newId = newId;
  }

  async #all() {
    if (!this.#loadPromise) this.#loadPromise = this.#store.load();
    return this.#loadPromise;
  }

  #mutate(operation) {
    const task = async () => operation(await this.#all());
    this.#mutationQueue = this.#mutationQueue.catch(() => undefined).then(task);
    return this.#mutationQueue;
  }

  async add({ code, tags = [], language = null, description = '' }) {
    code = asNonEmptyString(code, 'Code content');
    tags = normalizeTags(tags);
    description = asOptionalString(description, 'Description');
    const resolvedLanguage = language == null ? detectLanguage(code) : asNonEmptyString(language, 'Language').trim();
    const embedding = await this.#embedder.embed(embeddingText({ code, tags, language: resolvedLanguage, description }));

    return this.#mutate(async (snippets) => {
      const timestamp = this.#now();
      const snippet = { id: this.#newId(), code, tags, language: resolvedLanguage, description, embedding, createdAt: timestamp, updatedAt: timestamp };
      snippets.push(snippet);
      await this.#store.save(snippets);
      return withoutEmbedding(snippet);
    });
  }

  async update(id, updates) {
    asNonEmptyString(id, 'ID');
    if (!updates || typeof updates !== 'object') throw new TypeError('Updates must be an object.');
    if (!Object.keys(updates).some((key) => ['code', 'tags', 'language', 'description'].includes(key))) {
      throw new TypeError('Provide at least one supported field to update.');
    }

    return this.#mutate(async (snippets) => {
      const index = snippets.findIndex((snippet) => snippet.id === id);
      if (index < 0) throw new Error(`Snippet with ID ${id} not found.`);
      const current = snippets[index];
      const codeChanged = updates.code !== undefined;
      const code = codeChanged ? asNonEmptyString(updates.code, 'Code content') : current.code;
      const tags = updates.tags === undefined ? current.tags : normalizeTags(updates.tags);
      const description = updates.description === undefined ? current.description : asOptionalString(updates.description, 'Description');
      const language = updates.language === undefined
        ? (codeChanged ? detectLanguage(code) : current.language)
        : asNonEmptyString(updates.language, 'Language').trim();
      const needsEmbedding = codeChanged || updates.tags !== undefined || updates.description !== undefined || updates.language !== undefined || !Array.isArray(current.embedding);
      const embedding = needsEmbedding
        ? await this.#embedder.embed(embeddingText({ code, tags, language, description }))
        : current.embedding;
      const snippet = { ...current, code, tags, language, description, embedding, updatedAt: this.#now() };
      snippets[index] = snippet;
      await this.#store.save(snippets);
      return withoutEmbedding(snippet);
    });
  }

  async delete(id) {
    asNonEmptyString(id, 'ID');
    return this.#mutate(async (snippets) => {
      const index = snippets.findIndex((snippet) => snippet.id === id);
      if (index < 0) return false;
      snippets.splice(index, 1);
      await this.#store.save(snippets);
      return true;
    });
  }

  async get(id) {
    asNonEmptyString(id, 'ID');
    const snippet = (await this.#all()).find((item) => item.id === id);
    return snippet ? withoutEmbedding(snippet) : null;
  }

  async search({ query, tags, language, dateStart, dateEnd, limit = DEFAULT_RESULT_LIMIT } = {}) {
    if (query !== undefined && typeof query !== 'string') throw new TypeError('Query must be a string.');
    const requestedTags = tags === undefined ? undefined : normalizeTags(tags);
    const parsedStart = dateStart === undefined ? undefined : new Date(dateStart);
    const parsedEnd = dateEnd === undefined ? undefined : new Date(dateEnd);
    if (parsedStart && Number.isNaN(parsedStart.valueOf())) throw new TypeError('dateStart must be a valid date.');
    if (parsedEnd && Number.isNaN(parsedEnd.valueOf())) throw new TypeError('dateEnd must be a valid date.');
    if (parsedStart && parsedEnd && parsedStart > parsedEnd) throw new TypeError('dateStart must be before dateEnd.');
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) throw new RangeError(`Limit must be an integer between 1 and ${MAX_RESULT_LIMIT}.`);

    let results = (await this.#all()).filter((snippet) => {
      if (language && snippet.language.toLowerCase() !== language.toLowerCase()) return false;
      if (requestedTags && !requestedTags.every((tag) => snippet.tags.includes(tag))) return false;
      const createdAt = new Date(snippet.createdAt);
      return (!parsedStart || createdAt >= parsedStart) && (!parsedEnd || createdAt <= parsedEnd);
    });

    if (query?.trim()) {
      let queryEmbedding;
      try { queryEmbedding = await this.#embedder.embed(query); } catch { /* keyword search remains available */ }
      results = results.map((snippet) => {
        const keyword = keywordScore(`${snippet.code} ${snippet.tags.join(' ')} ${snippet.description}`, query);
        const semantic = queryEmbedding ? cosineSimilarity(queryEmbedding, snippet.embedding) : null;
        const score = semantic === null ? keyword : (semantic * 0.7) + (keyword * 0.3);
        return { ...snippet, score };
      }).filter((snippet) => snippet.score >= MIN_SCORE).sort((a, b) => b.score - a.score);
    } else {
      results = results.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return results.slice(0, limit).map(withoutEmbedding);
  }
}
