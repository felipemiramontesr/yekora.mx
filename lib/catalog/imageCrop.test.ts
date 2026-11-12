import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasBlob, drawSquare, openImage, OUTPUT_WIDTHS } from './imageCrop';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A canvas whose 2D context records what is drawn on it. */
function fakeCanvas(context: object | null = {}) {
  const calls: unknown[][] = [];
  const ctx = {
    fillStyle: '',
    imageSmoothingQuality: '',
    fillRect: (...args: unknown[]) => calls.push(['fillRect', ...args]),
    drawImage: (...args: unknown[]) => calls.push(['drawImage', ...args]),
    ...context,
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) =>
      context === null || kind !== '2d' ? null : ctx,
    toBlob: vi.fn(),
  };
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    calls,
    ctx,
    raw: canvas,
  };
}

describe('image crop (FC 029 F3, T1.2 D)', () => {
  it('accepts exactly the three widths of the API: large, catalog and thumbnail', () => {
    expect(OUTPUT_WIDTHS).toEqual([1200, 600, 300]);
  });

  it('selects the largest square of the photo at zoom 1, and a smaller one as the zoom grows', () => {
    /** The source square the crop draws: its corner and side in photo pixels. */
    const square = (
      width: number,
      height: number,
      crop: { zoom: number; x: number; y: number }
    ) => {
      const { canvas, calls } = fakeCanvas();
      drawSquare(canvas, { width, height } as ImageBitmap, crop, 300);
      const [, , sx, sy, side] = calls[1];
      return { sx, sy, side };
    };
    // A landscape photo: the square is as tall as the photo and slides sideways.
    expect(square(1000, 500, { zoom: 1, x: 0, y: 0 })).toEqual({
      sx: 0,
      sy: 0,
      side: 500,
    });
    expect(square(1000, 500, { zoom: 1, x: 1, y: 1 })).toEqual({
      sx: 500,
      sy: 0,
      side: 500,
    });
    expect(square(1000, 500, { zoom: 2, x: 0.5, y: 0.5 })).toEqual({
      sx: 375,
      sy: 125,
      side: 250,
    });
    // A portrait photo slides up and down.
    expect(square(400, 800, { zoom: 1, x: 0.5, y: 1 })).toEqual({
      sx: 0,
      sy: 400,
      side: 400,
    });
  });

  it('reads a file as an image, and answers null for what the browser cannot decode', async () => {
    const bitmap = { width: 10, height: 10 };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    await expect(openImage(file)).resolves.toBe(bitmap);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('x'))
    );
    await expect(openImage(file)).resolves.toBeNull();
  });

  it('draws the chosen square resized to the width, over white', () => {
    const { canvas, calls, ctx } = fakeCanvas();
    const image = { width: 1000, height: 500 } as ImageBitmap;
    expect(drawSquare(canvas, image, { zoom: 2, x: 0.5, y: 0.5 }, 600)).toBe(
      true
    );
    expect([canvas.width, canvas.height]).toEqual([600, 600]);
    expect(ctx.fillStyle).toBe('#ffffff');
    expect(ctx.imageSmoothingQuality).toBe('high');
    expect(calls).toEqual([
      ['fillRect', 0, 0, 600, 600],
      ['drawImage', image, 375, 125, 250, 250, 0, 0, 600, 600],
    ]);
  });

  it('says so when the browser gives no 2D context', () => {
    const { canvas } = fakeCanvas(null);
    const image = { width: 10, height: 10 } as ImageBitmap;
    expect(drawSquare(canvas, image, { zoom: 1, x: 0, y: 0 }, 300)).toBe(false);
  });

  it('encodes as WebP, and as JPEG when the browser answers with another type', async () => {
    const webp = new Blob(['w'], { type: 'image/webp' });
    const first = fakeCanvas();
    first.raw.toBlob.mockImplementation((done: (blob: Blob) => void) =>
      done(webp)
    );
    await expect(canvasBlob(first.canvas)).resolves.toBe(webp);
    expect(first.raw.toBlob).toHaveBeenCalledTimes(1);
    expect(first.raw.toBlob.mock.calls[0].slice(1)).toEqual([
      'image/webp',
      0.85,
    ]);

    // An older Safari cannot encode WebP and returns a PNG: the JPEG is encoded instead.
    const png = new Blob(['p'], { type: 'image/png' });
    const jpeg = new Blob(['j'], { type: 'image/jpeg' });
    const second = fakeCanvas();
    second.raw.toBlob
      .mockImplementationOnce((done: (blob: Blob) => void) => done(png))
      .mockImplementationOnce((done: (blob: Blob) => void) => done(jpeg));
    await expect(canvasBlob(second.canvas)).resolves.toBe(jpeg);
    expect(second.raw.toBlob.mock.calls[1].slice(1)).toEqual([
      'image/jpeg',
      0.9,
    ]);

    // Nothing at all: null, never a throw.
    const third = fakeCanvas();
    third.raw.toBlob.mockImplementation((done: (blob: null) => void) =>
      done(null)
    );
    await expect(canvasBlob(third.canvas)).resolves.toBeNull();
  });
});
