// Bounded ZIP transport for institution source packs; never extracts to disk.
(() => {
  "use strict";
  const LIMIT = 1024 * 1024;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function validName(name) {
    return typeof name === "string" && name.length <= 160 && /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) && !name.split("/").some((part) => part === "." || part === "..");
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function read(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length > LIMIT * 2 || bytes.length < 22) throw new Error("Choose an institution archive smaller than 2 MB.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0 || view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) throw new Error("Invalid institution ZIP archive.");
    const count = view.getUint16(end + 10, true);
    const central = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count < 1 || count > 20 || central + view.getUint32(end + 12, true) !== end) throw new Error("Unsupported institution ZIP layout.");
    const files = Object.create(null);
    const names = new Set();
    const ranges = [];
    let cursor = central;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid institution ZIP directory.");
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const crc = view.getUint32(cursor + 16, true);
      const packed = view.getUint32(cursor + 20, true);
      const size = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extra = view.getUint16(cursor + 30, true);
      const comment = view.getUint16(cursor + 32, true);
      const local = view.getUint32(cursor + 42, true);
      if ((flags & 1) || ![0, 8].includes(method) || size > 262144 || (total += size) > LIMIT || cursor + 46 + nameLength + extra + comment > end || local + 30 > central) throw new Error("Institution archive is encrypted, too large or uses unsupported compression.");
      const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (!validName(name) || names.has(name.toLowerCase())) throw new Error("Institution archive contains an unsafe or duplicate filename.");
      names.add(name.toLowerCase());
      if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags) throw new Error("Institution ZIP headers do not match.");
      const localNameLength = view.getUint16(local + 26, true);
      const data = local + 30 + localNameLength + view.getUint16(local + 28, true);
      if (data + packed > central || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name || ranges.some(([a, b]) => local < b && data + packed > a)) throw new Error("Institution ZIP entries overlap or do not match.");
      ranges.push([local, data + packed]);
      let contents = bytes.subarray(data, data + packed);
      if (method === 8 && typeof module !== "undefined") {
        contents = new Uint8Array(require("node:zlib").inflateRawSync(contents, { maxOutputLength: Math.max(1, size) }));
      } else if (method === 8) {
        const reader = new Blob([contents]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
        const chunks = [];
        let length = 0;
        try {
          while (true) {
            const item = await reader.read(); if (item.done) break;
            length += item.value.length;
            if (length > size) throw new Error("Institution archive expanded beyond its declared size.");
            chunks.push(item.value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        contents = new Uint8Array(length);
        let offset = 0; for (const chunk of chunks) { contents.set(chunk, offset); offset += chunk.length; }
      }
      if (contents.length !== size || crc32(contents) !== crc) throw new Error("Institution archive failed its integrity check.");
      files[name] = decoder.decode(contents);
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== end || !Object.hasOwn(files, "manifest.json")) throw new Error("The institution archive needs manifest.json at its root.");
    let manifest;
    try { manifest = JSON.parse(files["manifest.json"]); } catch { throw new Error("The institution archive manifest is invalid."); }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || Object.hasOwn(manifest, "files")) throw new Error("Invalid institution archive manifest.");
    delete files["manifest.json"];
    return { ...manifest, files };
  }
  function write(pack) {
    const { files, ...manifest } = pack;
    const entries = [["manifest.json", JSON.stringify(manifest, null, 2) + "\n"], ...Object.entries(files || {})];
    if (entries.length > 20) throw new Error("An institution archive supports at most 20 files.");
    const chunks = [];
    const central = [];
    let offset = 0;
    let total = 0;
    const names = new Set();
    for (const [name, source] of entries) {
      if (!validName(name) || names.has(name.toLowerCase()) || typeof source !== "string") throw new Error("Invalid institution archive entry.");
      names.add(name.toLowerCase());
      const filename = encoder.encode(name);
      const body = encoder.encode(source);
      if (body.length > 262144 || (total += body.length) > LIMIT) throw new Error("Institution archive content exceeds its size limit.");
      const crc = crc32(body);
      const header = new Uint8Array(30); const h = new DataView(header.buffer);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, body.length, true); h.setUint16(26, filename.length, true);
      const record = new Uint8Array(46); const c = new DataView(record.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, body.length, true); c.setUint16(28, filename.length, true); c.setUint32(42, offset, true);
      chunks.push(header, filename, body); central.push(record, filename); offset += header.length + filename.length + body.length;
    }
    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array(22); const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
    const result = new Uint8Array(offset + centralSize + end.length);
    let position = 0; for (const chunk of [...chunks, ...central, end]) { result.set(chunk, position); position += chunk.length; }
    return result;
  }
  const api = Object.freeze({ read, write });
  globalThis.InstitutionPackArchive = api;
  if (typeof module !== "undefined") module.exports = api;
})();
