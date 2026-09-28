import { requireOptionalNativeModule } from 'expo'
import { ImportError } from '../import/errors'
import type { OcrPage } from './types'

/**
 * The platform boundary for reading text out of an image.
 *
 * The same role `googleAuth.ts` plays for sign-in: every engine-specific detail
 * stops here, and everything above it works on `OcrPage`. Today that engine is
 * Apple Vision, wrapped by the local module in `modules/vision-text`. Adding
 * Android means adding an ML Kit branch *in this file* and nothing else — the
 * parser, the screens and the whole test suite are already engine-agnostic.
 *
 * Vision is chosen over a cross-platform package for two reasons: it is
 * markedly better on French printed type and is the only on-device option with
 * any real chance at handwriting, and it can be run from a Mac over a saved
 * photo, which is what lets `scripts/ocr/fixture.sh` record test fixtures from
 * the very engine the phone will use.
 */

type NativeLine = {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

type NativeModule = {
  recognize: (uri: string, languages: string[]) => Promise<{
    width: number
    height: number
    lines: NativeLine[]
  }>
}

/**
 * Most of this cookbook is French; English is offered alongside because the
 * family's recipes are not all in one language and Vision takes the list as an
 * order of preference rather than a filter.
 */
const LANGUAGES = ['fr-FR', 'en-US']

const native = requireOptionalNativeModule<NativeModule>('VisionText')

/** Whether this build can read text at all, so the UI can hide what it cannot do. */
export function canRecognizeText(): boolean {
  return !!native
}

export async function recognizeText(uri: string): Promise<OcrPage> {
  if (!native) throw new ImportError('unreadable')

  let page: Awaited<ReturnType<NativeModule['recognize']>>
  try {
    page = await native.recognize(uri, LANGUAGES)
  } catch {
    // A file that will not decode and a Vision failure are the same thing to a
    // cook: this photo did not work, try another.
    throw new ImportError('unreadable')
  }

  const lines = (page.lines ?? []).filter((line) => line.text?.trim())
  if (!lines.length) throw new ImportError('noText')

  return { width: page.width, height: page.height, lines }
}
