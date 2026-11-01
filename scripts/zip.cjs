const fs = require('node:fs');
const path = require('node:path');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function writeZip(entries, output) {
  const local = []; const central = []; const names = new Set(); let offset = 0;
  for (const [file, value] of entries) {
    if (!file || file.startsWith('/') || file.includes('\\') || file.split('/').some(part => !part || part === '.' || part === '..') || names.has(file.toLowerCase())) throw new Error('Unsafe or duplicate archive path.');
    names.add(file.toLowerCase());
    const name = Buffer.from(file); const bytes = Buffer.from(value); const crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(0x21, 14);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(bytes.length, 20); record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, name, bytes); central.push(record, name); offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, Buffer.concat([...local, directory, end]));
  return output;
}
function readStoredZip(file) {
  const bytes = fs.readFileSync(file); const entries = []; let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    if (bytes.readUInt16LE(offset + 8) !== 0 || bytes.readUInt16LE(offset + 6) & 9) throw new Error('Expected an unencrypted stored ZIP.');
    const size = bytes.readUInt32LE(offset + 18); const nameSize = bytes.readUInt16LE(offset + 26); const extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize).toString(); const start = offset + 30 + nameSize + extra;
    const data = bytes.subarray(start, start + size);
    if (data.length !== size || crc32(data) !== bytes.readUInt32LE(offset + 14)) throw new Error('ZIP integrity check failed.');
    entries.push([name, data]); offset = start + size;
  }
  if (!entries.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid stored ZIP.');
  return entries;
}
module.exports = { writeZip, readStoredZip };
