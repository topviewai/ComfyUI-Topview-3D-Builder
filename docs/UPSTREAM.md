# Updating the bundled editor

Plugin 0.1.14 includes **@topview/3d-builder 1.0.15**, commit
`03f49660e35bac0d2f290d3017a3b2b6186e1549` from the local upstream checkout.
The exact build provenance is also saved in `editor/upstream.json`.

This update includes grouped timeline editing, scene lighting controls, path/group
binding, keyframe and camera export fixes, and the film editing workspace.
The ComfyUI node ID and version-1 workflow state format remain unchanged.
Characters, poses, fonts and Draco decoders remain bundled for offline use.
Remote asset libraries and the upstream account/agent service are not configured.

**Permanent ComfyUI rule:** omit the **Motions** (`motion`) sidebar tab on every
upstream update. Keep **Camera moves** (`cameraMotion`) and existing animation
data. The build removes `motion` from the upstream sidebar's `TAB_ORDER` and
requires that adaptation to succeed; if upstream changes this structure, fix
the adaptation rather than bypassing the check. See the repository `AGENTS.md`.

## Rebuild

The upstream checkout must have its pnpm dependencies installed and no uncommitted
builder changes. From this plugin directory, run:

```powershell
node scripts/check-editor.mjs D:\topview-3d-builder
node scripts/test-host.mjs D:\topview-3d-builder
node scripts/test-export-settings.mjs
python scripts/test_export_backend.py
node scripts/build-editor.mjs D:\topview-3d-builder
```

Run the upstream `pnpm --filter @topview/3d-builder test:evaluate` suite as well.
These scripts use the upstream checkout's existing TypeScript/esbuild dependencies;
Node.js is needed only to rebuild, not to run the installed plugin.

`editor-src` owns the ComfyUI adapter: local asset search, version-1 scene state,
preview saving, iframe messaging, and native LoadImage/LoadVideo exports.
The node also exposes IMAGE/VIDEO outputs. `export_backend.py` requests rendering
from the submitting browser and returns native ComfyUI media; the inactive port
returns an ExecutionBlocker. `web/export-settings.js` owns the outer form and
`editor-src/export-bridge.ts` synchronizes it with the upstream export hook.
Build checks fail if upstream resolution/aspect choices or hook anchors change.
The build bundles the upstream editor source and styles without modifying that
checkout. Checked build-time substitutions remove the Motions sidebar tab, select
the local Draco decoder and the ComfyUI export label in both scene and film export dialogs. A changed
upstream integration point fails the build rather than silently dropping a patch.
The Save and Exit button is mounted in the upstream toolbar by a React portal.

After backend updates, restart ComfyUI, then refresh with Ctrl+F5. Verify scene loading, lighting,
timeline editing, Save and Exit, and image/video export to the canvas. Existing
workflows retain their scene data; save the ComfyUI workflow to persist edits.
Use `examples/topview-image-video.json` to check that selecting Image executes
only SaveImage, and selecting Video executes only SaveVideo. Keep the browser
open during rendering; verify parameter synchronization and connections after reload.
