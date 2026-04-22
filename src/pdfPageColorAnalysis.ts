/**
 * Heuristic color detection from rasterized PDF page pixels.
 * Tuned to approximate "would a copier charge this as color" — not ICC-accurate.
 */

export const DEFAULT_CHROMA_THRESHOLD = 26;
export const DEFAULT_NEAR_WHITE = 247;

/** Browser `ImageData` or any same-shaped buffer (for tests). */
export type RasterSample = Pick<ImageData, 'data' | 'width' | 'height'>;

export type CopierColorScore = {
  /** Pixels treated as non-blank (below near-white). */
  contentPixels: number;
  /** Pixels whose RGB span exceeds the chroma threshold. */
  colorPixels: number;
  /** colorPixels / contentPixels * 100 (0 if no content pixels). */
  colorPercentOfContent: number;
  /** Binary estimate for pricing / click charges. */
  isColor: boolean;
};

/**
 * Sample raster RGBA and estimate whether the page would be billed as color.
 * Uses chroma (max-min of RGB) on non-near-white pixels; ignores mostly-transparent pixels.
 */
export function analyzeImageDataForCopierColor(
  imageData: RasterSample,
  options?: {
    chromaThreshold?: number;
    nearWhite?: number;
    /** Sample every Nth pixel horizontally and vertically (1 = full scan). */
    stride?: number;
  }
): CopierColorScore {
  const chromaThreshold = options?.chromaThreshold ?? DEFAULT_CHROMA_THRESHOLD;
  const nearWhite = options?.nearWhite ?? DEFAULT_NEAR_WHITE;
  const stride = options?.stride ?? 2;

  const { data, width, height } = imageData;
  let contentPixels = 0;
  let colorPixels = 0;

  for (let y = 0; y < height; y += stride) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += stride) {
      const i = row + x * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 200) continue;
      if (r >= nearWhite && g >= nearWhite && b >= nearWhite) continue;

      contentPixels++;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min >= chromaThreshold) colorPixels++;
    }
  }

  const colorPercentOfContent =
    contentPixels > 0 ? (100 * colorPixels) / contentPixels : 0;

  // Sensitive to small logos: low absolute floor + fraction gate to shed JPEG speckle on gray fills.
  const minColorPixels = 5;
  const minFraction = 0.0000025;
  const isColor =
    contentPixels > 0 &&
    (colorPixels >= minColorPixels ||
      colorPixels / contentPixels >= minFraction);

  return { contentPixels, colorPixels, colorPercentOfContent, isColor };
}

export function pdfPointsToInches(pt: number): number {
  return pt / 72;
}
