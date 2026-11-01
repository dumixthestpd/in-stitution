const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createMetadataClient } = require('../mcp/metadata.cjs');
const { createServer } = require('../mcp/server.cjs');
const work = { DOI: '10.1000/fixture', title: ['Fixture article'], author: [{ given: 'A', family: 'Researcher' }], 'container-title': ['Fixture Journal'], published: { 'date-parts': [[2026]] } };
const jsonResponse = message => new Response(JSON.stringify({ message }), { status: 200, headers: { 'content-type': 'application/json' } });

test('metadata requests are bounded, cached, serialized and spaced without sharing browser state', async () => {
  let time = 1000;
  const calls = [];
  const client = createMetadataClient({ now: () => time, delay: async ms => { time += ms; }, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options, time });
    return jsonResponse({ items: [work], 'total-results': 1 });
  } });
  const result = await client.search({ query: 'fixture paper', limit: 3 });
  assert.equal(result.articles[0].doi, work.DOI);
  assert.equal(result.articles[0].year, 2026);
  assert.equal(result.articles[0].url, 'https://doi.org/10.1000/fixture');
  await Promise.all([client.search({ query: 'fixture paper', limit: 3 }), client.search({ query: 'another paper' })]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].time - calls[0].time >= 1000);
  assert.equal(calls[0].url.origin, 'https://api.crossref.org');
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(calls[0].options.redirect, 'error');
  assert.throws(() => client.search({ query: 'x' }), /Query must/);
  assert.throws(() => client.search({ query: 'valid query', limit: 100 }), /Limit must/);
  assert.throws(() => client.lookup({ doi: 'https://evil.test/' }), /Enter a DOI/);
});

test('metadata HTTP errors apply backoff and do not expose response bodies', async () => {
  let time = 1000;
  const waits = [];
  const client = createMetadataClient({ now: () => time, delay: async ms => { waits.push(ms); time += ms; }, fetchImpl: async () => new Response('private response', { status: 429, headers: { 'retry-after': '30' } }) });
  await assert.rejects(client.lookup({ doi: '10.1000/fixture' }), /HTTP 429/);
  await assert.rejects(client.lookup({ doi: '10.1000/other' }), /HTTP 429/);
  assert.ok(waits.includes(30000));
});

test('MCP initialization, tool schemas, argument rejection and errors use JSON-RPC', async () => {
  const handle = createServer({ search: async args => ({ articles: [args] }), lookup: async () => { throw new Error('private server body'); } });
  const call = (id, method, params) => handle({ jsonrpc: '2.0', id, method, params });
  assert.equal((await call(1, 'tools/list')).error.code, -32002);
  assert.equal((await call(2, 'initialize', { protocolVersion: '2025-06-18' })).result.protocolVersion, '2025-06-18');
  await call(undefined, 'notifications/initialized');
  const listed = (await call(3, 'tools/list')).result.tools;
  assert.deepEqual(listed.map(tool => tool.name), ['search_articles', 'get_article', 'search_zotero_library']);
  assert.equal(listed.some(tool => /download/.test(tool.name)), false);
  assert.equal((await call(4, 'tools/call', { name: 'search_articles', arguments: { query: 'fixture' } })).result.structuredContent.articles.length, 1);
  assert.equal((await call(5, 'tools/call', { name: 'search_articles', arguments: { query: 'fixture', password: 'not-accepted' } })).error.code, -32602);
  assert.equal((await call(6, 'tools/call', { name: 'get_article', arguments: { doi: '10.1000/fixture' } })).result.isError, true);
  assert.equal(JSON.stringify(await call(7, 'tools/call', { name: 'get_article' })).includes('private server body'), false);
});

test('MCP executable emits only newline-delimited protocol messages', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '../mcp/server.cjs')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, CROSSREF_MAILTO: '' } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stdin.end('not json\n' + JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 0);
  const replies = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(replies.find(reply => reply.id === null).error.code, -32700);
  assert.equal(replies.find(reply => reply.id === 2).result.tools.length, 3);
});
