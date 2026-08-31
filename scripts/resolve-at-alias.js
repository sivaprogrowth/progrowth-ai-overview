/**
 * Zero-dependency runtime resolver for the `@/*` path alias used
 * throughout lib/**, so a plain `node` process (no webpack/Next.js
 * bundler) can require() production files unmodified. TypeScript's
 * `paths` config in tsconfig.scripts.json only satisfies the type
 * checker — it does not rewrite emitted `require("@/lib/x")` calls, so
 * without this hook Node can't find the module at runtime.
 *
 * Load with: node --require ./scripts/resolve-at-alias.js ...
 * Temporary/dev-only — not part of the production build (Next.js/webpack
 * already resolves `@/*` on its own via next.config / tsconfig, and never
 * loads this file).
 */
const Module = require('module')
const path = require('path')

// `@/lib/x` in the SOURCE maps to the COMPILED `<buildDir>/lib/x.js` at
// runtime, not the .ts source — resolve relative to whichever build
// output directory actually contains the requiring file (tsconfig.test.json
// -> .test-build, tsconfig.scripts.json -> .scripts-build), not the repo
// root, so this hook works from either compiled tree.
const originalResolve = Module._resolveFilename

Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/') && parent && parent.filename) {
    const buildRoot = findBuildRoot(parent.filename)
    if (buildRoot) {
      const mapped = path.join(buildRoot, request.slice(2))
      return originalResolve.call(this, mapped, parent, ...rest)
    }
  }
  return originalResolve.call(this, request, parent, ...rest)
}

/** Walk up from a compiled file's path to the nearest `.*-build` root. */
function findBuildRoot(fromFile) {
  let dir = path.dirname(fromFile)
  const { root } = path.parse(dir)
  while (dir !== root) {
    if (/(^|[\\/])\.[^\\/]*-build$/.test(dir)) return dir
    dir = path.dirname(dir)
  }
  return null
}
