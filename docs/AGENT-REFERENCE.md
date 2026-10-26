# Agent staging reference adaptation

Reference checkout: `C:/Users/Administrator/Downloads/topview-3d-builder`.
The reference contains a Python CLI (`agent/topview_3d_cli`) and an agent skill; it is not the hosted chat-agent backend.

The plugin staging prompt in `editor-src/agent-prompt.ts` adapts the following Topview guides:
- `skills/topview-3d-cli/SKILL.md`
- `references/layout.md`, `add-prop.md`, `pose.md`, `camera.md`, `checks.md`

Attribution: Scene3D by Topview, Copyright (c) Topview. Reference code and documentation: Apache-2.0. See `AGENT-REFERENCE-LICENSE.txt`. The prompt is adapted for the browser-based ComfyUI host, not copied as CLI execution instructions.

Implemented: explicit spatial planning and support rules; reviewed pose-name guidance with current-catalog validation; independent atomic editing batches; explicit camera positioning; geometry and character data in scene reads; full installed pose catalog per page; conservative static primitive measurements with unavailable results for posed/rotated/animated objects. No turn or tool-call count cap has been reintroduced.

Not implemented: CLI project/BOM persistence, mesh and bone landmark measurements, seated-character automatic fitting, renderer-backed frustum/contact inspection, visual model review of rendered images, external generation services. Numeric bounds must not be represented as visual acceptance. Existing Motions removal remains mandatory; Camera moves and existing animation remain intact.

Validation uses mock model responses and deterministic scene-tool tests. It does not establish real-model aesthetic quality; that still requires user-provider scene trials.
