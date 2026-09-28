/**
 * Lets Node run this codebase's TypeScript directly, extensionless imports and all.
 *
 * Metro resolves `./media` to `./media.ts`; Node's ESM resolver does not, and the
 * sources are written for Metro. Rather than litter production imports with `.ts`
 * extensions to suit the test runner, the runner is taught Metro's rule. Node
 * strips the types itself, so this hook is the only thing standing between
 * `node --test` and a test suite — no bundler, no transform, no dev dependency.
 */
import { registerHooks } from 'node:module'

const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      // Only relative paths get the Metro treatment; a bare package name that
      // does not resolve is a genuinely missing dependency and should say so.
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error
      for (const extension of CANDIDATES) {
        try {
          return nextResolve(specifier + extension, context)
        } catch {
          // Try the next shape.
        }
      }
      throw error
    }
  },
})
