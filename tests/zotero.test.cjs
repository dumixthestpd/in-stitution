const test = require('node:test');
const assert = require('node:assert/strict');
const { createZoteroClient } = require('../mcp/zotero.cjs');
const { createServer } = require('../mcp/server.cjs');

test('library search delegates to Zotero with metadata-only GET requests and no browser credentials', async () => {
  const calls = [];
  const client = createZoteroClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify([
      { key: 'ABCD1234', data: { itemType: 'journalArticle', title: 'Saved paper', DOI: '10.1000/fixture', date: '2026', abstractNote: 'not returned', creators: [{ firstName: 'A', lastName: 'Researcher' }], attachments: [{ file: 'not returned' }] } },
      { key: 'FILE1234', data: { itemType: 'attachment', title: 'Private file', filename: 'not returned' } }
    ]), { headers: { 'Total-Results': '1' } });
  } });
  const result = await client.search({ query: 'Saved paper', limit: 2 });
  assert.equal(calls[0].url.origin, 'http://127.0.0.1:23119');
  assert.equal(calls[0].url.pathname, '/api/users/0/items/top');
  assert.equal(calls[0].url.searchParams.get('qmode'), 'titleCreatorYear');
  assert.equal(calls[0].url.searchParams.get('limit'), '2');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].key, 'ABCD1234');
  assert.equal(JSON.stringify(result).includes('not returned'), false);
  await assert.rejects(client.search({ query: 'x' }), /Query must/);
  await assert.rejects(client.search({ query: 'valid', limit: 99 }), /Limit must/);
});

test('library failures return setup guidance without exposing local response contents', async () => {
  const forbidden = createZoteroClient({ fetchImpl: async () => new Response('private library detail', { status: 403 }) });
  await assert.rejects(forbidden.search({ query: 'paper' }), error => /HTTP 403/.test(error.message) && !error.message.includes('private'));
  const offline = createZoteroClient({ fetchImpl: async () => { throw new Error('private path'); } });
  await assert.rejects(offline.search({ query: 'paper' }), /Zotero Desktop is not reachable/);
});

test('MCP exposes the existing library search adapter without save or download automation', async () => {
  let query;
  const handle = createServer({}, { search: async args => { query = args.query; return { source: 'Zotero Desktop', items: [] }; } });
  await handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  await handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const result = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_zotero_library', arguments: { query: 'paper' } } });
  assert.equal(query, 'paper');
  assert.equal(result.result.structuredContent.source, 'Zotero Desktop');
  const tools = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.equal(tools.result.tools.some(tool => /save|download|import/.test(tool.name)), false);
});
