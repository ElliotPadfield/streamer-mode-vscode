const fs = require('fs');
const zlib = require('zlib');

// Minimal PNG writer for a solid or simple gradient image (128x128)
// Generates a small, clean icon to keep VSIX size and scanner happy.

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([t, data]));
  crc.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(width, height, pixelsRGBA) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Filter type 0 per row
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[(stride + 1) * y] = 0; // no filter
    pixelsRGBA.copy(raw, (stride + 1) * y + 1, stride * y, stride * (y + 1));
  }
  const idatData = zlib.deflateSync(raw, { level: 9 });
  const iend = Buffer.alloc(0);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', iend)
  ]);
}

function makeGradient(w, h, top = [10,15,26], bottom = [30,60,100]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const r = Math.round(top[0] * (1 - t) + bottom[0] * t);
    const g = Math.round(top[1] * (1 - t) + bottom[1] * t);
    const b = Math.round(top[2] * (1 - t) + bottom[2] * t);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

(function main() {
  const w = 128, h = 128;
  const px = makeGradient(w, h, [10,15,26], [17,25,40]);
  const data = png(w, h, px);
  const outPath = process.argv[2] || 'icon.png';
  fs.writeFileSync(outPath, data);
  const kb = (data.length / 1024).toFixed(1);
  console.log(`Wrote ${outPath} (${kb} KB)`);
})();

