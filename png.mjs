// Minimal dependency-free PNG encoder (Node)
// Used by the headless QA renderer so that frames produced by the exact same
// drawing code the browser runs can be inspected as real PNG images.
import zlib from 'node:zlib';
import fs from 'node:fs';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {Uint32Array} data  0xAABBGGRR framebuffer (little-endian RGBA)
 * @param {number} w
 * @param {number} h
 * @param {number} scale  integer nearest-neighbour upscale
 * @returns {Buffer} PNG bytes
 */
export function encodePNG(data, w, h, scale = 1) {
  const ow = w * scale;
  const oh = h * scale;
  const raw = Buffer.alloc(oh * (ow * 4 + 1));
  let p = 0;
  for (let y = 0; y < oh; y++) {
    raw[p++] = 0; // filter: none
    const sy = (y / scale) | 0;
    for (let x = 0; x < ow; x++) {
      const c = data[sy * w + ((x / scale) | 0)] >>> 0;
      raw[p++] = c & 0xff;
      raw[p++] = (c >>> 8) & 0xff;
      raw[p++] = (c >>> 16) & 0xff;
      raw[p++] = (c >>> 24) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ow, 0);
  ihdr.writeUInt32BE(oh, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function savePNG(path, data, w, h, scale = 1) {
  fs.writeFileSync(path, encodePNG(data, w, h, scale));
}
