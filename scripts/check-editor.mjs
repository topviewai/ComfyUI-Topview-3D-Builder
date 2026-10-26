import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const upstream = path.resolve(process.argv[2] || 'D:/topview-3d-builder')
const builder = path.join(upstream, 'packages/builder')
const requireUpstream = createRequire(path.join(upstream, 'package.json'))
const ts = requireUpstream('typescript')
const deps = path.join(builder, 'node_modules').replaceAll('\\', '/')
const program = ts.createProgram([path.join(root, 'editor-src/main.tsx')], {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
  strict: true, skipLibCheck: true, noEmit: true, esModuleInterop: true,
  baseUrl: root, types: [],
  paths: {
    '@topview/3d-builder': [path.join(builder, 'src/index.ts')],
    '@topview/3d-builder/evaluate': [path.join(builder, 'src/evaluate/index.ts')],
    'zod': [`${deps}/zod`],
    'zod-to-json-schema': [`${deps}/zod-to-json-schema`],
    'react': [`${deps}/@types/react/index.d.ts`],
    'react/*': [`${deps}/@types/react/*`],
    'react-dom/*': [`${deps}/@types/react-dom/*`],
    'react-dom': [`${deps}/@types/react-dom/index.d.ts`],
  },
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: (name) => name, getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log('ComfyUI host and upstream TypeScript contracts passed.')
