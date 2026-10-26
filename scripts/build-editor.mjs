import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import {resolutions,aspects} from '../web/export-settings.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const upstream = path.resolve(process.argv[2] || 'D:/topview-3d-builder')
const builder = path.join(upstream, 'packages/builder')
const source = path.join(builder, 'src')
const exportUtils = fs.readFileSync(path.join(source,'components/dialogs/utils.ts'),'utf8')
const upstreamHeights = [...exportUtils.matchAll(/\{ height: (\d+), label: '\d+p' \}/g)].map(m=>Number(m[1]))
const aspectSource = fs.readFileSync(path.join(source,'contract/aspectRatio.ts'),'utf8')
const aspectMenu = aspectSource.match(/export const ASPECT_RATIO_MENU_ORDER[^=]*= \[([\s\S]*?)\]/)?.[1]
const upstreamAspects = aspectMenu ? ['auto', ...[...aspectMenu.matchAll(/'([0-9]+:[0-9]+)'/g)].map(m=>m[1])] : []
if(JSON.stringify(upstreamHeights)!==JSON.stringify(resolutions)||JSON.stringify(upstreamAspects)!==JSON.stringify(aspects)) throw new Error('Upstream export choices changed; synchronize the node export form before rebuilding.')
const requireUpstream = createRequire(path.join(upstream, 'package.json'))
const requireTsup = createRequire(requireUpstream.resolve('tsup'))
const { build } = requireTsup('esbuild')
const hostModule = JSON.stringify(path.join(root, 'editor-src/host.ts').replaceAll('\\', '/'))
const version = JSON.parse(fs.readFileSync(path.join(builder, 'package.json'), 'utf8')).version
const commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (execFileSync('git', ['-C', upstream, 'status', '--porcelain', '--', 'packages/builder', 'pnpm-lock.yaml'], { encoding: 'utf8' }).trim()) {
  throw new Error('Upstream builder has uncommitted changes; commit or restore them before recording a release build.')
}
const styles = ['fonts', 'tokens', 'base', 'layout', 'viewport', 'inspector', 'library', 'timeline', 'film', 'dialog', 'tutorial', 'dropdown', 'tooltip', 'agent']
const patches = new Set()
const result = await build({
  stdin: {
    contents: styles.map((name) => `import ${JSON.stringify(path.join(source, 'styles', `${name}.css`).replaceAll('\\', '/'))}`).join('\n') + '\nimport "./editor-src/main.tsx"',
    resolveDir: root, sourcefile: 'main.tsx', loader: 'tsx',
  },
  outfile: path.join(root, 'editor/main.js'), bundle: true, minify: true, format: 'esm', platform: 'browser',
  jsx: 'automatic', target: ['es2022'], legalComments: 'external', write: false,
  nodePaths: [path.join(builder, 'node_modules'), path.join(upstream, 'node_modules')],
  alias: { '@topview/3d-builder/evaluate': path.join(source, 'evaluate/index.ts'), '@topview/3d-builder': path.join(source, 'index.ts') },
  loader: { '.woff2': 'file' }, assetNames: 'fonts/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"', __T3D_DEV__: 'false' },
  plugins: [{ name: 'comfyui-host', setup(context) {
    context.onLoad({filter:/[\\/]hooks[\\/]useExportDialog\.ts$/}, args => {
      let contents = fs.readFileSync(args.path,'utf8')
      const replacements = [
        ["const t = useT()", "const t = useT(); const savedExport = getHostExportSettings()"],
        ["useState<ExportOutputKind>('image')", "useState<ExportOutputKind>(savedExport?.output ?? 'image')"],
        ["useState<ExportTimeUnit>('frames')", "useState<ExportTimeUnit>(savedExport?.timeUnit ?? 'frames')"],
        ["resolveDefaultExportCameraId(cameras, activeCameraId, EDITOR_EXPORT_CAMERA_ID),", "savedExport?.cameraId ?? resolveDefaultExportCameraId(cameras, activeCameraId, EDITOR_EXPORT_CAMERA_ID),"],
        ["useState(() => clampFrame(frame, fs, fe))", "useState(() => clampFrame(savedExport?.currentFrame ?? frame, fs, fe))"],
        ["useState(tl?.frameStart ?? 0)", "useState(savedExport?.start ?? tl?.frameStart ?? 0)"],
        ["useState(defaultEnd)", "useState(savedExport?.end ?? defaultEnd)"],
        ["useState(() => exportAspectSetting(doc, cameraId))", "useState(() => savedExport?.aspectRatio ?? exportAspectSetting(doc, cameraId))"],
        ["useState<ExportHeight>(DEFAULT_EXPORT_HEIGHT)", "useState<ExportHeight>(savedExport?.exportHeight ?? DEFAULT_EXPORT_HEIGHT)"],
        ["    setEnd(clampFrame(defaultEnd, fs, fe))", "    if (!savedExport) setEnd(clampFrame(defaultEnd, fs, fe))"],
        ["    if (cameraId === EDITOR_EXPORT_CAMERA_ID) {", "    if (savedExport) return\n    if (cameraId === EDITOR_EXPORT_CAMERA_ID) {"],
        ["  const actions = useExportActions", "  useHostExportSettings({output,fps:savedExport?.fps ?? tl?.fps ?? 24,timeUnit,cameraId,currentFrame,start,end,aspectRatio,exportHeight,numericAspect})\n  const actions = useExportActions"],
      ]
      for(const [from,to] of replacements) { if(!contents.includes(from)) throw new Error('Export settings adapter needs review: '+from); contents=contents.replace(from,to) }
      contents = contents.replaceAll('fps: tl?.fps ?? 30', 'fps: savedExport?.fps ?? tl?.fps ?? 24').replaceAll('fps: tl?.fps }', 'fps: savedExport?.fps ?? tl?.fps }')
      patches.add('export-settings')
      const module = JSON.stringify(path.join(root,'editor-src/export-bridge.ts').replaceAll('\\','/'))
      return {contents:`import {getHostExportSettings,useHostExportSettings} from ${module}\n`+contents,loader:'ts'}
    })
    context.onLoad({ filter: /[\\/]agent[\\/]models\.ts$/ }, (args) => {
      const original = fs.readFileSync(args.path, 'utf8')
      const pattern = /export function prepareScene3dModelsForSelector\(models: AgentModelOption\[\]\): AgentModelOption\[\] \{[\s\S]*?\n\}/
      if (!pattern.test(original)) throw new Error('Agent model selector adapter needs review')
      patches.add('agent-models')
      return { contents: original.replace(pattern, 'export function prepareScene3dModelsForSelector(models: AgentModelOption[]): AgentModelOption[] { return models }'), loader: 'ts' }
    })
    context.onLoad({ filter: /[\\/]components[\\/]leftrail[\\/]constants\.ts$/ }, (args) => {
      const original = fs.readFileSync(args.path, 'utf8')
      const tabOrder = /export const TAB_ORDER: LibraryTab\[\] = \[([\s\S]*?)\]/
      const match = original.match(tabOrder)
      if (!match || !/^\s*'motion',\s*$/m.test(match[1]) || !match[1].includes("'cameraMotion'")) {
        throw new Error('ComfyUI must omit the Motions sidebar tab: review the upstream TAB_ORDER adapter')
      }
      const contents = original.replace(tabOrder, (_, tabs) =>
        `export const TAB_ORDER: LibraryTab[] = [${tabs.replace(/^\s*'motion',\s*$/m, '')}]`)
      patches.add('no-motions-tab')
      return { contents, loader: 'ts', resolveDir: path.dirname(args.path) }
    })
    context.onLoad({ filter: /(?:AssetLoader\.ts|ExportDialog\.tsx|FilmExportDialog\.tsx)$/ }, (args) => {
      let contents = fs.readFileSync(args.path, 'utf8')
      const filename = path.basename(args.path)
      if (filename === 'AssetLoader.ts') {
        const original = "'https://www.gstatic.com/draco/versioned/decoders/1.5.7/'"
        if (!contents.includes(original)) throw new Error('Draco adapter needs review for this upstream version')
        contents = contents.replace(original, "new URL('./draco/', location.href).href")
      } else {
        const original = "s.t('export.sendToCanvas')"
        if (!contents.includes(original)) throw new Error(`${filename}: export label adapter needs review`)
        contents = `import { hostText } from ${hostModule}\n` + contents.replaceAll(original, "hostText('send')")
      }
      patches.add(filename)
      return { contents, loader: filename.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) }
    })
  } }],
})
for (const name of ['export-settings', 'agent-models', 'no-motions-tab', 'AssetLoader.ts', 'ExportDialog.tsx', 'FilmExportDialog.tsx']) {
  if (!patches.has(name)) throw new Error(`Missing required ComfyUI adapter: ${name}`)
}
for (const file of result.outputFiles) {
  fs.mkdirSync(path.dirname(file.path), { recursive: true })
  fs.writeFileSync(file.path, file.contents)
}
fs.writeFileSync(path.join(root, 'editor/upstream.json'), JSON.stringify({ package: '@topview/3d-builder', version, commit }, null, 2) + '\n')
console.log(`Built ComfyUI editor from @topview/3d-builder ${version} (${commit})`)
