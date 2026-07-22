import os from 'node:os';
import path from 'node:path';

import { EMBEDDING_MODEL } from './constants.js';
import { TransformerEmbedder } from './embedding.js';
import { SnippetService } from './snippet-service.js';
import { JsonSnippetStore } from './storage.js';

const databasePath = process.env.SNIPPETS_FILE_PATH || path.join(os.homedir(), 'snippets-mcp-db.json');
const service = new SnippetService({
  store: new JsonSnippetStore(databasePath),
  embedder: new TransformerEmbedder(EMBEDDING_MODEL)
});

export const addSnippet = (input) => service.add(input);
export const updateSnippet = (id, updates) => service.update(id, updates);
export const deleteSnippet = (id) => service.delete(id);
export const getSnippet = (id) => service.get(id);
export const search = (params) => service.search(params);

export { SnippetService } from './snippet-service.js';
export { JsonSnippetStore } from './storage.js';
