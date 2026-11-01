#!/usr/bin/env node
// MCP 2025-06-18 stdio: one JSON-RPC message per line, no listening socket.
const { createMetadataClient } = require('./metadata.cjs');
const { createZoteroClient } = require('./zotero.cjs');
const version = require('../package.json').version;
const tools = [
  { name: 'search_articles', description: 'Search public Crossref bibliographic metadata across publishers. Returns titles, authors, DOI links and publication details, not full text or institutional holdings.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 500 }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
  { name: 'get_article', description: 'Look up public bibliographic metadata for one DOI. Open its DOI URL in your browser for institutional sign-in. This tool does not retrieve a PDF.', inputSchema: { type: 'object', properties: { doi: { type: 'string', maxLength: 300 } }, required: ['doi'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
  { name: 'search_zotero_library', description: 'Search saved research references in your personal Zotero Desktop library by title, creator or year using Zotero’s local API. Returns citation metadata and item keys only. Does not read PDFs, add records or maintain a separate index.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 240 }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }
];
function createServer(client = createMetadataClient({ mailto: process.env.CROSSREF_MAILTO || '' }), library = createZoteroClient()) {
  let initialized = false;
  let active = false;
  return async request => {
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (request.id !== undefined && typeof request.id !== 'number' && typeof request.id !== 'string')) return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request.' } };
    const reply = result => ({ jsonrpc: '2.0', id: request.id, result });
    const error = (code, message) => ({ jsonrpc: '2.0', id: request.id, error: { code, message } });
    if (request.id === undefined) {
      if (request.method === 'notifications/initialized' && initialized) active = true;
      return null;
    }
    if (request.method === 'initialize') {
      if (initialized) return error(-32600, 'Already initialized.');
      initialized = true;
      return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'in-stitution', version }, instructions: 'Search Crossref for new references and Zotero Desktop for saved references. Open DOI pages in the institution-enabled browser, then save using the native Zotero Connector or EndNote Click controls. Use existing reference-manager integrations for library writes. This server has no capture or download automation; any agent-driven PDF retrieval must respect the minimum 30-second article interval.' });
    }
    if (request.method === 'ping') return reply({});
    if (!active) return error(-32002, 'Initialize the MCP connection first.');
    if (request.method === 'tools/list') return reply({ tools });
    if (request.method !== 'tools/call') return error(-32601, 'Method not found.');
    const { name, arguments: args = {} } = request.params || {};
    const tool = tools.find(item => item.name === name);
    if (!tool) return error(-32602, 'Unknown tool.');
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key))) return error(-32602, 'Invalid tool arguments.');
    try {
      const result = await (name === 'search_zotero_library' ? library.search(args) : name === 'search_articles' ? client.search(args) : client.lookup(args));
      return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
    } catch (cause) {
      const message = /^(?:Query must|Limit must|Enter a DOI|Crossref returned|Metadata response|Zotero )/.test(cause.message) ? cause.message : 'Metadata request failed or timed out. Try again later.';
      return reply({ isError: true, content: [{ type: 'text', text: message }] });
    }
  };
}
function serve() {
  const handle = createServer();
  let buffer = '';
  let pending = 0;
  const write = response => { if (response) process.stdout.write(JSON.stringify(response) + '\n'); };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 65536) { process.stderr.write('MCP input exceeded 64 KB.\n'); process.exitCode = 1; process.stdin.destroy(); return; }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let request;
      try { request = JSON.parse(line); }
      catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }); continue; }
      if (pending >= 8) { if (request?.id !== undefined) write({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Too many pending requests.' } }); continue; }
      pending++;
      void handle(request).then(write, () => write({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32603, message: 'Internal error.' } })).finally(() => { pending--; });
    }
  });
}
if (require.main === module) serve();
module.exports = { createServer };
