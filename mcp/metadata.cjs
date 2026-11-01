// Public bibliographic metadata only. No university credentials or full text.
const API = 'https://api.crossref.org/works';
const VERSION = require('../package.json').version;
function createMetadataClient({ fetchImpl = fetch, now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)), mailto = '' } = {}) {
  const cache = new Map();
  let queue = Promise.resolve();
  let nextRequestAt = 0;
  if (mailto && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailto)) throw new Error('CROSSREF_MAILTO must be an email address.');
  function simplify(work) {
    const doi = typeof work.DOI === 'string' ? work.DOI : '';
    return { doi, title: work.title?.[0] || '', authors: (work.author || []).slice(0, 30).map(author => author.name || [author.given, author.family].filter(Boolean).join(' ')),
      journal: work['container-title']?.[0] || '', publisher: work.publisher || '', year: (work.published || work.issued)?.['date-parts']?.[0]?.[0] || null,
      url: doi ? 'https://doi.org/' + encodeURI(doi).replace(/[?#]/g, encodeURIComponent) : null, type: work.type || '' };
  }
  async function request(url) {
    const key = url.href;
    const previous = queue;
    let unlock;
    queue = new Promise(resolve => { unlock = resolve; });
    await previous;
    try {
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;
      await delay(Math.max(0, nextRequestAt - now()));
      nextRequestAt = now() + 1000;
      const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': `in-stitution-metadata/${VERSION}` + (mailto ? ` (mailto:${mailto})` : '') }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) {
        const retry = Math.min(300, Math.max(1, Number(response.headers.get('retry-after')) || 30));
        if (response.status === 429 || response.status === 503) nextRequestAt = now() + retry * 1000;
        throw new Error(`Crossref returned HTTP ${response.status}. Try again later.`);
      }
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Metadata response exceeded its size limit.'); }
        chunks.push(value);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const value = Array.isArray(result.message?.items) ? { total: result.message['total-results'], articles: result.message.items.map(simplify), source: 'Crossref' } : { article: simplify(result.message || {}), source: 'Crossref' };
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expiresAt: now() + 5 * 60 * 1000 });
      return value;
    } finally { unlock(); }
  }
  function endpoint(path = '') {
    const url = new URL(API + path);
    if (mailto) url.searchParams.set('mailto', mailto);
    return url;
  }
  return {
    search({ query, limit = 5 }) {
      if (typeof query !== 'string' || query.trim().length < 2 || query.length > 500) throw new Error('Query must contain 2–500 characters.');
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Limit must be an integer from 1 to 20.');
      const url = endpoint();
      url.searchParams.set('query.bibliographic', query.trim());
      url.searchParams.set('rows', String(limit));
      return request(url);
    },
    lookup({ doi }) {
      if (typeof doi !== 'string' || doi.length > 300 || !/^10\.\d{4,9}\/[^\s?#]+$/.test(doi)) throw new Error('Enter a DOI such as 10.1038/nature14539.');
      return request(endpoint('/' + encodeURIComponent(doi)));
    }
  };
}
module.exports = { createMetadataClient };
