# Agent search and native reference managers

## MCP setup

Run `node mcp/server.cjs` with Node.js 22 or later. The dependency-free server speaks MCP **2025-06-18** over stdio and opens no listening port. Configure your MCP client with:

```json
{
  "mcpServers": {
    "in-stitution": {
      "command": "node",
      "args": ["/absolute/path/to/in-stitution/mcp/server.cjs"]
    }
  }
}
```

## Available tools

| Tool | Existing service used |
| --- | --- |
| `search_articles({"query":"deep learning","limit":5})` | Crossref public bibliographic search |
| `get_article({"doi":"10.1038/nature14539"})` | Crossref DOI lookup |
| `search_zotero_library({"query":"deep learning","limit":5})` | Zotero Desktop's personal-library search |

Open returned DOI links in your normal browser. in-stitution handles supported institutional sign-in; save with the native Zotero Connector or EndNote Click controls. Use existing reference-manager integrations for other library operations.

Zotero must be running with its local API enabled in Advanced settings. The adapter makes metadata-only GET requests to `127.0.0.1:23119`, searching title, creator and year with a five-second timeout and at most 20 results. It returns scholarly-reference metadata and keys, excludes notes/attachments, and maintains no separate database or index. Group libraries and full-text search are outside this adapter's scope. Zotero data stays local unless your MCP client sends tool results elsewhere.

Crossref queries leave the device. Set `CROSSREF_MAILTO` for an optional contact email. Calls are serialized, spaced at least one second apart, bounded to 20 results and 15 seconds, cached for five minutes, and backed off after rate limits. Coverage follows deposited metadata, not subscription holdings. University credentials, cookies and browser sessions never enter MCP.

Implementation follows the official [MCP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) and [Zotero local API](https://www.zotero.org/support/dev/web_api/v3/local_api).

## Capture boundaries

There are no library-write, capture or PDF-download tools. Native reference managers own translators, collection selection and attachments. The v0.6.0 PDF helper is retired; reload existing article tabs after upgrading.

Agent-controlled attachment retrieval must leave **at least 30 seconds between articles**, including retries, across every retrieval path. This release exposes no such automation because a reliable coordinated interface across native extensions has not been established. Manual native saves operate independently and are not rate-limited by in-stitution.
