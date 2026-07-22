#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import {
    addSnippet, 
    updateSnippet, 
    deleteSnippet, 
    getSnippet, 
    search 
} from './index.js';
import { PRODUCT_INFO, MAX_RESULT_LIMIT } from './constants.js';

const server = new McpServer({
    "name": PRODUCT_INFO.name,
    "version": PRODUCT_INFO.version
});

// Tool 1: Add Snippet
server.registerTool(
    'add-snippet',
    {
        title: 'Add Code Snippet',
        description: 'Saves a new code snippet with optional tags, language, and description. Language is auto-detected if not provided. Later, search is performed using semantic (on fields: description, tags, language, code) and keyword (on fields: code, tags)',
        inputSchema: z.object({
            code: z.string().describe('The code content to save'),
            tags: z.array(z.string()).optional().default([]).describe('Array of tags for categorization (e.g., ["api", "authentication"])'),
            language: z.string().optional().nullable().describe('Programming language (e.g., "javascript", "python"). Auto-detected if null'),
            description: z.string().optional().default('').describe('Detailed description of what the code does for better semantic and keyword search')
        })
    },
    async (params) => {
        try {
            const result = await addSnippet({
                code: params.code,
                tags: params.tags,
                language: params.language,
                description: params.description
            });
            
            return {
                content: [{ 
                    type: 'text', 
                    text: `Snippet saved successfully!\n\nID: ${result.id}\nLanguage: ${result.language}\nTags: ${result.tags.join(', ')}\nCreated: ${result.createdAt}` 
                }]
            };
        } catch (error) {
            return {
                content: [{ 
                    type: 'text', 
                    text: `Error adding snippet: ${error.message}` 
                }],
                isError: true
            };
        }
    }
);

// Tool 2: Search Snippets
server.registerTool(
    'search-snippets',
    {
        title: 'Search Code Snippets',
        description: 'Search snippets using semantic search (on fields: description, tags, language, code) + keyword search (on fields: code, tags), tags, language, or date filters. Uses hybrid semantic + keyword search.',
        inputSchema: z.object({
            query: z.string().optional().describe('Natural language search query (e.g., "function to calculate factorial", "async error handling")'),
            tags: z.array(z.string()).optional().describe('Filter by specific tags (AND logic - snippet must have ALL tags)'),
            language: z.string().optional().describe('Filter by programming language'),
            dateStart: z.string().datetime({ offset: true }).optional().describe('Filter by creation date start (ISO-8601 timestamp)'),
            dateEnd: z.string().datetime({ offset: true }).optional().describe('Filter by creation date end (ISO-8601 timestamp)'),
            limit: z.number().int().min(1).max(MAX_RESULT_LIMIT).optional().default(10).describe(`Maximum number of results (1-${MAX_RESULT_LIMIT})`)
        })
    },
    async (params) => {
        try {
            const results = await search({
                query: params.query,
                tags: params.tags,
                language: params.language,
                dateStart: params.dateStart,
                dateEnd: params.dateEnd,
                limit: params.limit
            });
            
            if (results.length === 0) {
                return {
                    content: [{ 
                        type: 'text', 
                        text: 'No snippets found matching your criteria.' 
                    }]
                };
            }
            
            const formattedResults = results.map((snippet, index) => {
                return `## Result ${index + 1}${snippet.score ? ` (Score: ${snippet.score.toFixed(3)})` : ''}
**ID:** ${snippet.id}
**Language:** ${snippet.language}
**Tags:** ${snippet.tags.join(', ')}
**Description:** ${snippet.description || 'N/A'}
**Created:** ${snippet.createdAt}
**Updated:** ${snippet.updatedAt}

\`\`\`${snippet.language}
${snippet.code}
\`\`\`
`;
            }).join('\n---\n\n');
            
            return {
                content: [{ 
                    type: 'text', 
                    text: `Found ${results.length} snippet(s):\n\n${formattedResults}` 
                }]
            };
        } catch (error) {
            return {
                content: [{ 
                    type: 'text', 
                    text: `Error searching snippets: ${error.message}` 
                }],
                isError: true
            };
        }
    }
);

// Tool 3: Get Snippet by ID
server.registerTool(
    'get-snippet',
    {
        title: 'Get Snippet by ID',
        description: 'Retrieves a specific code snippet by its unique ID.',
        inputSchema: z.object({
            id: z.string().describe('The unique ID of the snippet to retrieve')
        })
    },
    async (params) => {
        try {
            const snippet = await getSnippet(params.id);
            
            if (!snippet) {
                return {
                    content: [{ 
                        type: 'text', 
                        text: `Snippet with ID "${params.id}" not found.` 
                    }]
                };
            }
            
            const formatted = `**ID:** ${snippet.id}
**Language:** ${snippet.language}
**Tags:** ${snippet.tags.join(', ')}
**Description:** ${snippet.description || 'N/A'}
**Created:** ${snippet.createdAt}
**Updated:** ${snippet.updatedAt}

\`\`\`${snippet.language}
${snippet.code}
\`\`\``;
            
            return {
                content: [{ 
                    type: 'text', 
                    text: formatted 
                }]
            };
        } catch (error) {
            return {
                content: [{ 
                    type: 'text', 
                    text: `Error retrieving snippet: ${error.message}` 
                }],
                isError: true
            };
        }
    }
);

// Tool 4: Update Snippet
server.registerTool(
    'update-snippet',
    {
        title: 'Update Code Snippet',
        description: 'Updates an existing snippet. Only provide fields you want to change.',
        inputSchema: z.object({
            id: z.string().describe('The unique ID of the snippet to update'),
            code: z.string().optional().describe('Updated code content'),
            tags: z.array(z.string()).optional().describe('Updated tags array'),
            language: z.string().optional().describe('Updated language'),
            description: z.string().optional().describe('Updated description')
        })
    },
    async (params) => {
        try {
            const result = await updateSnippet(params.id, {
                code: params.code,
                tags: params.tags,
                language: params.language,
                description: params.description
            });
            
            return {
                content: [{ 
                    type: 'text', 
                    text: `Snippet updated successfully!\n\nID: ${result.id}\nLanguage: ${result.language}\nTags: ${result.tags.join(', ')}\nUpdated: ${result.updatedAt}` 
                }]
            };
        } catch (error) {
            return {
                content: [{ 
                    type: 'text', 
                    text: `Error updating snippet: ${error.message}` 
                }],
                isError: true
            };
        }
    }
);

// Tool 5: Delete Snippet
server.registerTool(
    'delete-snippet',
    {
        title: 'Delete Code Snippet',
        description: 'Permanently deletes a code snippet by its ID.',
        inputSchema: z.object({
            id: z.string().describe('The unique ID of the snippet to delete')
        })
    },
    async (params) => {
        try {
            const deleted = await deleteSnippet(params.id);
            
            if (deleted) {
                return {
                    content: [{ 
                        type: 'text', 
                        text: `Snippet with ID "${params.id}" deleted successfully.` 
                    }]
                };
            } else {
                return {
                    content: [{ 
                        type: 'text', 
                        text: `Snippet with ID "${params.id}" not found.` 
                    }]
                };
            }
        } catch (error) {
            return {
                content: [{ 
                    type: 'text', 
                    text: `Error deleting snippet: ${error.message}` 
                }],
                isError: true
            };
        }
    }
);

async function start() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Snippet Manager MCP server running on stdio');
}

start().catch((error) => {
    console.error(`Snippet-MCP server shutdown with error: ${error.message}`);
    process.exitCode = 1;
});
