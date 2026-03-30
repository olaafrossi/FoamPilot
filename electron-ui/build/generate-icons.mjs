// Generate platform-specific icons from icon.svg
import sharp from 'sharp';
import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, 'icon.svg');
const svgBuffer = readFileSync(svgPath);

// Generate PNG at 512x512 (Linux, also used as source for ICO)
await sharp(svgBuffer).resize(512, 512).png().toFile(join(__dirname, 'icon.png'));
console.log('Created icon.png (512x512)');

// Generate ICO with multiple sizes embedded
// ICO format: header + entries + image data
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];

for (const size of icoSizes) {
  const buf = await sharp(svgBuffer).resize(size, size).png().toBuffer();
  images.push({ size, data: buf });
}

// Build ICO file
const headerSize = 6;
const entrySize = 16;
let dataOffset = headerSize + entrySize * images.length;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type: ICO
header.writeUInt16LE(images.length, 4); // count

const entries = [];
const dataBuffers = [];

for (const img of images) {
  const entry = Buffer.alloc(entrySize);
  entry.writeUInt8(img.size < 256 ? img.size : 0, 0);  // width (0 = 256)
  entry.writeUInt8(img.size < 256 ? img.size : 0, 1);  // height
  entry.writeUInt8(0, 2);         // color palette
  entry.writeUInt8(0, 3);         // reserved
  entry.writeUInt16LE(1, 4);      // color planes
  entry.writeUInt16LE(32, 6);     // bits per pixel
  entry.writeUInt32LE(img.data.length, 8);   // data size
  entry.writeUInt32LE(dataOffset, 12);       // data offset
  entries.push(entry);
  dataBuffers.push(img.data);
  dataOffset += img.data.length;
}

const ico = Buffer.concat([header, ...entries, ...dataBuffers]);
writeFileSync(join(__dirname, 'icon.ico'), ico);
console.log('Created icon.ico');

console.log('Done! Icons generated in build/');
console.log('Note: For macOS .icns, electron-builder will auto-convert from icon.png');
