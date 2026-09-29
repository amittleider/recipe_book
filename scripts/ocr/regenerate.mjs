/**
 * Re-records every fixture from the image it came from.
 *
 * The fixtures are the test suite's input, and they are *derived* — from the
 * pages in `fixtures/pages` and from the Swift in `modules/vision-text/ios`.
 * Whenever that Swift changes, every fixture is stale, and a suite passing
 * against stale fixtures is a suite testing a pipeline that no longer exists.
 * This makes bringing them back in line one command, so there is no reason to
 * skip it.
 *
 * Expect the results to move a little when the reader changes: recognition is
 * not a pure function of the bytes. Read the diff rather than waving it through
 * — that diff is the only honest record of what a change to the pipeline did.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const pages = join(root, 'src', 'import', 'image', 'fixtures', 'pages')
const manifest = JSON.parse(readFileSync(join(pages, 'pages.json'), 'utf8'))

const only = process.argv.slice(2)
const wanted = only.length
  ? manifest.pages.filter((entry) => only.includes(entry.fixture))
  : manifest.pages

if (!wanted.length) {
  console.error(`no such fixture: ${only.join(', ')}`)
  process.exit(1)
}

for (const entry of wanted) {
  const args = [join(pages, entry.page), entry.fixture, ...(entry.languages ?? [])]
  if (entry.raw) args.push('--raw')
  const output = execFileSync(join(here, 'fixture.sh'), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  process.stdout.write(output)
}
