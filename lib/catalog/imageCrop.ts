/**
 * The square crop of a product photo, in the browser (FC 029 F3, T1.2 D): the administrator picks
 * a region of the photo with a zoom and a position, and the Canvas resizes it to one of the three
 * widths the API accepts. No native dependency: `createImageBitmap` reads the file, a 2D canvas
 * draws the square and `toBlob` encodes it, WebP first and JPEG where the browser cannot encode
 * WebP. The public site shows product photos as squares, so the crop is a square.
 *
 * @module
 */

/** Widths the API accepts, large to thumbnail (1200 large, 600 catalog, 300 thumbnail). */
export const OUTPUT_WIDTHS = [1200, 600, 300] as const;

/** Which part of the photo the square shows: a zoom from 1 up, and a position in 0…1. */
export interface Crop {
  /** 1 shows the largest square the photo holds; 2 shows half of its side. */
  zoom: number;
  /** 0 is the left edge of the photo, 1 the right edge. */
  x: number;
  /** 0 is the top edge of the photo, 1 the bottom edge. */
  y: number;
}

/**
 * The region of the photo a crop selects: always a square inside the photo.
 *
 * @param width - Width of the photo in pixels.
 * @param height - Height of the photo in pixels.
 * @param crop - Zoom and position.
 * @returns Its top-left corner and its side, in photo pixels.
 */
function squareOf(
  width: number,
  height: number,
  crop: Crop
): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height) / crop.zoom;
  return {
    sx: (width - side) * crop.x,
    sy: (height - side) * crop.y,
    side,
  };
}

/**
 * Reads a file as an image. The file is not trusted: anything the browser cannot decode is null.
 *
 * @param file - What the administrator chose.
 * @returns The decoded image, or null.
 */
export async function openImage(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

/**
 * Draws a crop of the photo on a canvas, resized to a square of `size` pixels, over white so a
 * transparent PNG does not turn black in a JPEG.
 *
 * @param canvas - The canvas to draw on; its size is set here.
 * @param image - The decoded photo.
 * @param crop - Zoom and position.
 * @param size - Side of the square in pixels.
 * @returns False when the browser gives no 2D context.
 */
export function drawSquare(
  canvas: HTMLCanvasElement,
  image: ImageBitmap,
  crop: Crop,
  size: number
): boolean {
  const context = canvas.getContext('2d');
  if (context === null) return false;
  const { sx, sy, side } = squareOf(image.width, image.height, crop);
  canvas.width = size;
  canvas.height = size;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  return true;
}

/** `toBlob` as a promise. */
const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });

/**
 * Encodes a canvas as WebP, or as JPEG when the browser answers with another type (an older
 * Safari cannot encode WebP and returns PNG).
 *
 * @param canvas - A canvas already drawn.
 * @returns The encoded image, or null when the browser could not encode it.
 */
export async function canvasBlob(
  canvas: HTMLCanvasElement
): Promise<Blob | null> {
  const webp = await encode(canvas, 'image/webp', 0.85);
  return webp?.type === 'image/webp' ? webp : encode(canvas, 'image/jpeg', 0.9);
}
