// Dependency-free ZIP (stored entries). Only the loadable extension is packaged.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('./check.cjs');
const source = path.join(root, 'extension');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [];
const central = [];
let offset = 0;
function collect(directory, prefix = '') {
  return fs.readdirSync(directory).filter(name => name !== 'pack' && !/\.(?:cjs|md)$/.test(name) && !fs.existsSync(path.join(directory, name, 'package.json'))).sort().flatMap(name => {
    const input = path.join(directory, name); const file = prefix + name;
    return fs.statSync(input).isDirectory() ? collect(input, file + '/') : [{ file, source: input }];
  });
}
const files = collect(source);
files.push({ file: 'LICENSE', source: path.join(root, 'LICENSE') });
for (const { file, source: input } of files) {
  if (!fs.statSync(input).isFile()) throw new Error('Unexpected nested directory in extension');
  const name = Buffer.from(file);
  const bytes = fs.readFileSync(input);
  const crc = crc32(bytes);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(0x21, 12); // 1980-01-01: reproducible timestamps.
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(bytes.length, 18);
  header.writeUInt32LE(bytes.length, 22);
  header.writeUInt16LE(name.length, 26);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50);
  record.writeUInt16LE(20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x800, 8);
  record.writeUInt16LE(0x21, 14);
  record.writeUInt32LE(crc, 16);
  record.writeUInt32LE(bytes.length, 20);
  record.writeUInt32LE(bytes.length, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt32LE(offset, 42);
  local.push(header, name, bytes);
  central.push(record, name);
  offset += header.length + name.length + bytes.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const output = path.join(root, 'dist', `in-stitution-${version}.zip`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([...local, directory, end]));
console.log(output);
