import { ImportError } from './errors'

/**
 * Fetching a recipe page written by somebody else.
 *
 * This is a plain `fetch`, deliberately: it needs no native module, so import
 * ships without a rebuild. The cost is that a site behind bot protection
 * answers 403 no matter what headers we send — Allrecipes and Serious Eats both
 * do, today. Those are reported as `blocked` rather than dressed up as a parse
 * failure, because the page was never read and no parser would have helped.
 */

// Safari on iPhone. Not a disguise — the request really does come from an
// iPhone — but some sites serve a stripped page to anything they cannot name.
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const TIMEOUT_MS = 15_000

/** Recipe pages are large but not this large, and a phone should not hold more. */
const MAX_BYTES = 2_000_000

// React Native's `URL` is a partial polyfill, so the shape of a link is checked
// here rather than by constructing one.
const ABSOLUTE = /^https?:\/\/[^\s/?#]+\.[^\s/?#]+/i
const SCHEMELESS = /^[^\s/?#]+\.[^\s/?#]+/i

/** Accepts what a cook actually pastes, including a bare `marmiton.org/...`. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new ImportError('badUrl')
  if (ABSOLUTE.test(trimmed)) return trimmed
  if (SCHEMELESS.test(trimmed)) return `https://${trimmed}`
  throw new ImportError('badUrl')
}

export async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        // Most of this cookbook is French, so ask for French where a site offers it.
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
    })
  } catch {
    throw new ImportError('network')
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 401 || response.status === 429) {
      throw new ImportError('blocked')
    }
    throw new ImportError(response.status === 404 ? 'notFound' : 'http')
  }

  // A PDF or an image would parse to nothing useful and waste the download.
  const type = response.headers.get('content-type') ?? ''
  if (type && !/text\/html|application\/xhtml/i.test(type)) throw new ImportError('notHtml')

  try {
    return (await response.text()).slice(0, MAX_BYTES)
  } catch {
    throw new ImportError('network')
  }
}
