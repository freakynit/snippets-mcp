import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { pipeline } from '@xenova/transformers';
import hljs from 'highlight.js';

const homeDir = os.homedir();

// --- CONFIGURATION ---
const DB_FILE = process.env.SNIPPETS_FILE_PATH || path.join(homeDir, 'snippets-mcp-db.json');
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const MIN_SCORE = 0.3;

let initPromise = null;
let saveQueue = Promise.resolve();

// --- STATE MANAGEMENT ---
let vectorPipeline = null;
let snippetsCache = [];
let isInitialized = false;

const normalize = (str) => str.toLowerCase().replace(/[^\w\s\-_]/g, '');
const validateTags = (tags) => tags.map(t => t.toLowerCase().trim()).filter(t => t.length > 0);
const makeEmbedText = (description, tags, language, code) => [
        description,
        `Tags: ${tags.join(', ')}`,
        `Language: ${language}`,
        code
    ].filter(Boolean).join('\n\n');

// --- INITIALIZATION ---

/**
 * Loads the database and initializes the AI model.
 * Automatically called by the exported functions if not ready.
 */
async function init() {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            console.log('Loading AI model...');
            vectorPipeline = await pipeline('feature-extraction', EMBEDDING_MODEL);

            try {
                const data = await fs.readFile(DB_FILE, 'utf-8');
                snippetsCache = JSON.parse(data);
            } catch (err) {
                if (err.code === 'ENOENT') {
                    snippetsCache = [];
                    await saveDb();
                } else {
                    throw err;
                }
            }

            console.log(`System initialized. Loaded ${snippetsCache.length} snippets.`);
        } catch (error) {
            console.error("Initialization failed:", error);
            initPromise = null; // Allow retry
            throw error;
        } finally {
            isInitialized = true; // Only set once, after success
        }
    })();

    return initPromise;
}

/**
 * Persists the in-memory cache to disk.
 */
async function saveDb() {
    saveQueue = saveQueue.then(async () => {
        await fs.writeFile(DB_FILE, JSON.stringify(snippetsCache, null, 2));
    });
    return saveQueue;
}

// --- HELPER FUNCTIONS ---

/**
 * Generates a vector embedding for a given text string.
 */
async function generateEmbedding(text) {
    if (!vectorPipeline) await init();
    // Pooling 'mean' averages the token vectors to get a sentence vector
    const output = await vectorPipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

/**
 * Calculates Cosine Similarity between two vectors (A . B)
 * Vectors must be normalized.
 */
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct;
}

/**
 * Simple keyword match score (0 to 1)
 */
function keywordScore(text, query) {
    const tokens = normalize(query).split(/\s+/).filter(t => t.length > 2);
    if (tokens.length === 0) return 0;

    const normalizedText = normalize(text);
    let score = 0;
    
    tokens.forEach(token => {
        const regex = new RegExp(token, 'g');
        const tokenMatches = (normalizedText.match(regex) || []).length;
        score += Math.min(tokenMatches / tokens.length, 1);
    });

    return score / tokens.length;
}

/**
 * Auto-detects programming language using highlight.js
 */
function detectLanguage(code) {
    const result = hljs.highlightAuto(code);
    return result.language || 'plaintext';
}

// --- EXPORTED API ---

/**
 * Add a new code snippet.
 * @param {string} code - The code content.
 * @param {string[]} tags - Array of tags (optional).
 * @param {string} language - Language (optional, will auto-detect if null).
 * @param {string} description - Optional text description for better semantic search.
 */
export async function addSnippet({ code, tags = [], language = null, description = '' }) {
    if (!isInitialized) await init();

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
        throw new Error("Code content must be a non-empty string");
    }

    tags = validateTags(tags);

    const detectedLang = language || detectLanguage(code);
    
    try {
        // Create a rich text representation for the embedding
        // We combine code and description to allow searching by "what the code does"
        const embedText = makeEmbedText(description, tags, detectedLang, code);
        const embedding = await generateEmbedding(embedText);

        const newSnippet = {
            id: crypto.randomUUID(),
            code,
            language: detectedLang,
            tags: tags.map(t => t.toLowerCase()),
            description,
            embedding, // Store vector for fast retrieval
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        snippetsCache.push(newSnippet);
        saveDb();  // Don't await - let it run in background
        
        // Return the snippet without the heavy embedding array for the view
        const { embedding: _, ...result } = newSnippet;
        return result;
    } catch (error) {
        console.error('Failed to add snippet:', error);
        throw new Error(`Failed to create embedding: ${error.message}`);
    }
}

/**
 * Update an existing snippet.
 */
export async function updateSnippet(id, { code, tags, language, description }) {
    if (!isInitialized) await init();

    const index = snippetsCache.findIndex(s => s.id === id);
    if (index === -1) throw new Error(`Snippet with ID ${id} not found`);

    const snippet = snippetsCache[index];
    let needsReEmbedding = false;

    if (code !== undefined) {
        snippet.code = code;
        if (!language) snippet.language = detectLanguage(code); // Re-detect if code changes and lang not forced
        needsReEmbedding = true;
    }
    if (language !== undefined) snippet.language = language;
    if (tags !== undefined) {
        snippet.tags = tags.map(t => t.toLowerCase());
        needsReEmbedding = true;
    }
    if (description !== undefined) {
        snippet.description = description;
        needsReEmbedding = true;
    }

    if (needsReEmbedding) {
        const embedText = makeEmbedText(snippet.description, snippet.tags, snippet.language, snippet.code);
        snippet.embedding = await generateEmbedding(embedText);
    }

    snippet.updatedAt = new Date().toISOString();
    snippetsCache[index] = snippet;
    await saveDb();

    const { embedding: _, ...result } = snippet;
    return result;
}

/**
 * Delete a snippet.
 */
export async function deleteSnippet(id) {
    if (!isInitialized) await init();
    
    const initialLength = snippetsCache.length;
    snippetsCache = snippetsCache.filter(s => s.id !== id);
    
    if (snippetsCache.length !== initialLength) {
        await saveDb();
        return true;
    }
    return false;
}

/**
 * Get a single snippet by ID.
 */
export async function getSnippet(id) {
    if (!isInitialized) await init();
    const s = snippetsCache.find(x => x.id === id);
    if (!s) return null;
    const { embedding, ...rest } = s;
    return rest;
}

/**
 * Hybrid Search & Filtering
 * @param {Object} params
 * @param {string} params.query - Natural language query (e.g., "function to calculate factorial").
 * @param {string[]} params.tags - Filter by specific tags.
 * @param {string} params.language - Filter by language.
 * @param {Date} params.dateStart - Filter by creation date start.
 * @param {Date} params.dateEnd - Filter by creation date end.
 * @param {number} params.limit - Max results (default 10).
 */
export async function search({ query, tags, language, dateStart, dateEnd, limit = 10 }) {
    if (!isInitialized) await init();

    // 1. HARD FILTERS
    let results = snippetsCache.filter(item => {
        let pass = true;

        if (language && item.language.toLowerCase() !== language.toLowerCase()) pass = false;
        
        if (tags && tags.length > 0) {
            // Check if snippet has ALL requested tags (AND logic)
            const hasAllTags = tags.every(t => item.tags.includes(t.toLowerCase()));
            if (!hasAllTags) pass = false;
        }

        if (dateStart && new Date(item.createdAt) < new Date(dateStart)) pass = false;
        if (dateEnd && new Date(item.createdAt) > new Date(dateEnd)) pass = false;

        return pass;
    });

    // 2. HYBRID SEARCH (Semantic + Keyword)
    if (query) {
        let queryEmbedding;
        try {
            queryEmbedding = await generateEmbedding(query);
            
            results = results.map(item => {
                const semanticScore = cosineSimilarity(queryEmbedding, item.embedding);
                const textToScan = `${item.code} ${item.tags.join(' ')}`;
                const textScore = keywordScore(textToScan, query);

                const finalScore = (semanticScore * 0.7) + (textScore * 0.3);

                return { ...item, score: finalScore };
            });

            results.sort((a, b) => b.score - a.score);

        } catch (error) {
            console.warn('Semantic search failed, falling back to keyword-only:', error.message);
            // Fallback: Keep only already filtered 'results', just update their scores
            results = results.map(item => {
                const textScore = keywordScore(`${item.code} ${item.tags.join(' ')}`, query);
                return { ...item, score: textScore };
            });
            results.sort((a, b) => b.score - a.score);
        }
    } else {
        // If no query, sort by newest first
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }


    // 3. CLEANUP & RETURN
    return results
        .filter(item => !query || item.score >= MIN_SCORE)
        .slice(0, limit).map(item => {
            // Remove heavy embedding vector from output
            const { embedding, ...cleanSnippet } = item;
            return cleanSnippet;
        });
}
