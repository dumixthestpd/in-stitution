// Thin, read-only adapter to Zotero Desktop. Zotero owns storage and search.
function createZoteroClient({ fetchImpl = fetch } = {}) {
  return {
    async search({ query, limit = 5 }) {
      if (typeof query !== 'string' || query.trim().length < 2 || query.length > 240) throw new Error('Query must contain 2–240 characters.');
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Limit must be an integer from 1 to 20.');
      const url = new URL('http://127.0.0.1:23119/api/users/0/items/top');
      url.search = new URLSearchParams({ q: query.trim(), qmode: 'titleCreatorYear', limit: String(limit), format: 'json',
        itemType: 'journalArticle || conferencePaper || preprint || book || bookSection || thesis || report' });
      let response;
      try {
        response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', 'Zotero-API-Version': '3' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
      } catch { throw new Error('Zotero Desktop is not reachable. Open Zotero and enable its local API in Advanced settings.'); }
      if (!response.ok) throw new Error(`Zotero local API returned HTTP ${response.status}. Check its local API access settings.`);
      const text = await response.text();
      if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Zotero metadata response exceeded its size limit.');
      let items;
      try { items = JSON.parse(text); } catch { throw new Error('Zotero local API returned an invalid metadata response.'); }
      if (!Array.isArray(items)) throw new Error('Zotero local API returned an invalid item list.');
      return { source: 'Zotero Desktop', library: 'personal', total: Number(response.headers.get('total-results')) || items.length,
        items: items.filter(item => item.data && !['attachment', 'note', 'annotation'].includes(item.data.itemType)).slice(0, limit).map(item => ({
          key: item.key, title: item.data.title || '', itemType: item.data.itemType, date: item.data.date || '', doi: item.data.DOI || '',
          creators: (item.data.creators || []).map(creator => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' '))
        })) };
    }
  };
}
module.exports = { createZoteroClient };
