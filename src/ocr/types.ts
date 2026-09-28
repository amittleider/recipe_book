/**
 * What an OCR engine hands back, in the one shape this app parses.
 *
 * Deliberately the lowest common denominator of Apple Vision and ML Kit: a list
 * of text lines, each with a box. Everything downstream of here is pure
 * TypeScript working on this type, which is what lets the whole parser run — and
 * be tested — in Node with no simulator and no native module.
 *
 * Coordinates are **normalised to 0..1 with the origin at the top left**, so a
 * fixture recorded from a 3200px scan and a photo taken at 4032px compare
 * directly. Vision reports bottom-left origin and ML Kit reports pixels; both
 * are converted at the boundary rather than here.
 */

export type OcrLine = {
  text: string
  /** Left edge, 0..1. */
  x: number
  /** Top edge, 0..1. */
  y: number
  width: number
  height: number
  /** 0..1 where the engine reports one. Used to drop rubbish, never to rank. */
  confidence: number
}

export type OcrPage = {
  /** Pixel size of the image the lines were read from, for the record. */
  width: number
  height: number
  lines: OcrLine[]
}

export const lineRight = (line: OcrLine): number => line.x + line.width
export const lineBottom = (line: OcrLine): number => line.y + line.height
export const lineCentreY = (line: OcrLine): number => line.y + line.height / 2
