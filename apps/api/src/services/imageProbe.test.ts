import { describe, expect, it } from 'vitest';
import { probeImage } from './imageProbe';

/** A PNG header: signature, IHDR length and type, width, height (big-endian). */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** A JPEG: SOI, an APP0 segment, then a start-of-frame with the given marker. */
function jpeg(width: number, height: number, frame = 0xc0): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = frame;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

/** A WebP RIFF container whose first chunk is `chunk`, with `payload` from byte 20. */
function webp(chunk: string, payload: Buffer): Buffer {
  const bytes = Buffer.alloc(40);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(32, 4);
  bytes.write('WEBP', 8, 'latin1');
  bytes.write(chunk, 12, 'latin1');
  payload.copy(bytes, 20);
  return bytes;
}

/** VP8 (lossy): frame tag, keyframe start code, 14-bit width and height. */
function vp8(width: number, height: number, startCode = [0x9d, 0x01, 0x2a]) {
  const payload = Buffer.alloc(10);
  Buffer.from(startCode).copy(payload, 3);
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return webp('VP8 ', payload);
}

/** VP8L (lossless): signature 0x2f, then width-1 and height-1 in 14 bits each. */
function vp8l(width: number, height: number, signature = 0x2f) {
  const payload = Buffer.alloc(5);
  payload[0] = signature;
  payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  return webp('VP8L', payload);
}

/** VP8X (extended): flags, reserved, then width-1 and height-1 in 24 bits each. */
function vp8x(width: number, height: number) {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return webp('VP8X', payload);
}

describe('probeImage (FC 029 T1.2 M and D)', () => {
  it('reads a PNG from its IHDR', () => {
    expect(probeImage(png(1200, 800))).toEqual({
      type: 'image/png',
      width: 1200,
      height: 800,
    });
  });

  it('reads a JPEG from its first start-of-frame, past other segments', () => {
    expect(probeImage(jpeg(600, 450))).toEqual({
      type: 'image/jpeg',
      width: 600,
      height: 450,
    });
    expect(probeImage(jpeg(300, 300, 0xc2))).toMatchObject({ width: 300 });
  });

  it('reads the three WebP flavours: VP8, VP8L and VP8X', () => {
    expect(probeImage(vp8(1200, 900))).toEqual({
      type: 'image/webp',
      width: 1200,
      height: 900,
    });
    expect(probeImage(vp8l(600, 400))).toEqual({
      type: 'image/webp',
      width: 600,
      height: 400,
    });
    expect(probeImage(vp8x(300, 200))).toEqual({
      type: 'image/webp',
      width: 300,
      height: 200,
    });
  });

  it('never accepts SVG or text, whatever it claims to be (T2.2b)', () => {
    expect(
      probeImage(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
      )
    ).toBeNull();
    expect(probeImage(Buffer.from('GIF89a'))).toBeNull();
    expect(probeImage(Buffer.alloc(0))).toBeNull();
  });

  it('refuses a truncated or malformed PNG', () => {
    expect(probeImage(png(600, 600).subarray(0, 20))).toBeNull();
    const noHeader = png(600, 600);
    noHeader.write('IDAT', 12, 'latin1');
    expect(probeImage(noHeader)).toBeNull();
  });

  it('refuses a JPEG without a start-of-frame or with a broken segment', () => {
    // Only tables (DHT, the excluded C4) and then the end: no frame to read.
    const tablesOnly = jpeg(600, 600, 0xc4);
    expect(probeImage(tablesOnly)).toBeNull();
    // JPG (C8) and DAC (CC) are not frames either; nor is a marker past the SOF range.
    expect(probeImage(jpeg(600, 600, 0xc8))).toBeNull();
    expect(probeImage(jpeg(600, 600, 0xcc))).toBeNull();
    expect(probeImage(jpeg(600, 600, 0xd0))).toBeNull();
    expect(probeImage(jpeg(600, 600, 0xbf))).toBeNull();
    const broken = jpeg(600, 600);
    broken[8] = 0x00;
    expect(probeImage(broken)).toBeNull();
  });

  it('refuses a RIFF that is not WebP, or a WebP chunk it cannot read', () => {
    const wave = vp8(600, 600);
    wave.write('WAVE', 8, 'latin1');
    expect(probeImage(wave)).toBeNull();
    const notRiff = vp8(600, 600);
    notRiff.write('RIFX', 0, 'latin1');
    expect(probeImage(notRiff)).toBeNull();
    expect(probeImage(vp8(600, 600, [0, 0, 0]))).toBeNull();
    expect(probeImage(vp8l(600, 600, 0x00))).toBeNull();
    expect(probeImage(webp('ALPH', Buffer.alloc(10)))).toBeNull();
    expect(probeImage(vp8(600, 600).subarray(0, 29))).toBeNull();
  });
});
