# Snippets MCP
- MCP server for storing, searching, and managing code snippets using semantic search and traditional keyword matching. 
- Just tell your coding agent (claude code, cursor, cline, opencode, etc.) to save a certain snippet. That's it.
- When needed, just tell it to search for code snippets related to: `your query`.

## Features

- Semantic search using AI embeddings to find snippets by meaning, not just keywords
- Hybrid search combining semantic similarity and keyword matching
- Automatic programming language detection
- Tag-based organization and filtering
- Date range filtering
- No database needed. JSON based storage.
- Vector embeddings cached for fast retrieval

## Installation

```bash
npm install @freakynit/snippets-mcp
```

## Available Tools

### add-snippet

Adds a new code snippet to the database.

**Parameters:**
- `code` (string, required) - The code content
- `tags` (array, optional) - Array of tag strings
- `language` (string, optional) - Programming language (auto-detected if not provided)
- `description` (string, optional) - Text description for better semantic search

### search-snippets

Searches snippets using hybrid semantic and keyword matching.

**Parameters:**
- `query` (string, optional) - Natural language search query
- `tags` (array, optional) - Filter by specific tags (AND logic)
- `language` (string, optional) - Filter by programming language
- `dateStart` (ISO date string, optional) - Filter by creation date start
- `dateEnd` (ISO date string, optional) - Filter by creation date end
- `limit` (number, optional) - Maximum results to return (default: 10)

### update-snippet

Updates an existing snippet. Re-generates embeddings if code, tags, or description change.

**Parameters:**
- `id` (string, required) - Snippet ID
- `updates` (object) - Object containing fields to update (code, tags, language, description)

### delete-snippet

Deletes a snippet from the database.

**Parameters:**
- `id` (string, required) - Snippet ID

### get-snippet

Retrieves a single snippet by ID.

**Parameters:**
- `id` (string, required) - Snippet ID

## Environment Variables
1. `SNIPPETS_FILE_PATH`: Optional, Full path to file to save snippets and embeddings in. Defaults to `~/.snippets-mcp-db.json`.

## How It Works

The library uses a hybrid search approach:

1. **Semantic Search (70% weight)** - Uses the `all-MiniLM-L6-v2` model to perform vector searh against embeddings generated off code, description, tags and language.
2. **Keyword Matching (30% weight)** - Traditional text matching for exact term matches based on code and tags.
3. **Hard Filters** - Applied first to narrow results by tags, language, and date range.

Embeddings are generated once when adding/updating snippets and cached for fast retrieval.

## Storage

Snippets are stored in a JSON file specified by environment variable `SNIPPETS_FILE_PATH`, or at default path: `~/.snippets-mcp-db.json` with the following structure:

```json
{
  "id": "uuid",
  "code": "string",
  "language": "string",
  "tags": ["array"],
  "description": "string",
  "embedding": [/* vector array */],
  "createdAt": "ISO date",
  "updatedAt": "ISO date"
}
```

## Configuring using mcpServers json
> For Mac and Linux
```json
{
  "mcpServers": {
    "snippets-mcp": {
      "command": "npx",
      "args": ["-y", "@freakynit/snippets-mcp@latest"],
      "env": {
        "SNIPPETS_FILE_PATH": "Optional... path to save snippets and embeddings in.. should have .json extension"
      }
    }
  }
}
```

> For Windows
```json
{
  "mcpServers": {
    "snippets-mcp": {
      "command": "cmd",
      "args": ["/k", "npx", "-y", "@freakynit/snippets-mcp@latest"],
      "env": {
        "SNIPPETS_FILE_PATH": "Optional... path to save snippets and embeddings in.. should have .json extension"
      }
    }
  }
}
```

## License

[MIT](LICENSE)

