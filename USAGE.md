# Topview 3D Builder for ComfyUI

Use the **Use AI Agent** guide card to visit [Topview 3D Builder](https://github.com/topviewai/topview-3d-builder) and copy installation instructions for your agent. Built-in chat and API-key settings have been removed. See [Agent guide](docs/AGENT.md).

## Getting started

The interface follows the language selected in ComfyUI, including node buttons, the toolbar, render preview controls, and status messages.
Supported languages are Simplified Chinese, Traditional Chinese, English, Japanese, Korean, French, German, Spanish, Portuguese, Russian, Arabic, Turkish, Indonesian, Malay, and Vietnamese.
Changing the language does not affect scene data. Unsupported languages fall back to English. Technical errors from the backend and third-party components remain in their original language.

1. Restart ComfyUI and refresh your browser.
2. Double-click the node canvas and search for `Topview 3D Builder`, or add it from the `Topview` category.
3. Click **Open 3D Builder** on the node. The editor opens in a centered dialog that uses 90% of the window's width and height.
4. Add characters and props, adjust poses and cameras, and animate the scene on the timeline.
5. Click **Export** in the editor. Choose image or video output, a camera, resolution, and frame range, then click **Export to ComfyUI canvas**. After a successful export, the scene is saved, the node preview is updated, and the editor closes. If export or saving fails, the editor stays open so you can retry.
6. Click **Save and Exit** in the toolbar to save the scene, update the node preview, and close the editor without exporting media. If saving fails, the editor stays open and displays an error so you can retry.
7. Save your workflow in ComfyUI to preserve the scene and keyframes in the node properties.

Drag `examples/topview-3d-preview.json` into ComfyUI to open a sample scene with two posed characters.

## Exporting and saving

- The Builder node exposes `image` (IMAGE) and `video` (VIDEO) outputs. Its external export form has an Image/Video dropdown, camera, frames/seconds, current frame or start/end range, resolution (720p/1080p/1440p), and aspect ratio. Settings synchronize with the internal Image/Video export dialog. Frame rate comes from the scene timeline.
- Export controls use native ComfyUI combo and number widgets. The lower preview updates automatically when a setting affects the rendered result: still images show the selected frame; videos play the selected range with pause/seek controls. Camera, resolution, aspect ratio and saved scene changes regenerate the preview. Changes are debounced and obsolete previews are cancelled; previews stay in browser memory and do not create workflow output files.
- Connect the outputs directly to downstream nodes and run the workflow. Only the selected media type is rendered; the other output blocks its downstream branch, without disconnecting wires or sending a placeholder. The browser must remain open because rendering uses its WebGL engine. Save and exit the editor before running; current-view exports use that saved view. Automated API clients need a connected browser client to perform rendering.
- Exported video nodes adjust their height to the video's aspect ratio, including when resized horizontally. Dragging the video picture moves the node, while the playback controls remain interactive.
- The internal **Export to ComfyUI canvas** action still creates a separate `LoadImage` or `LoadVideo` node. This is optional; the Builder outputs can now feed the workflow directly. Film/sequence export remains available inside the editor.
- Exported files are saved in `ComfyUI/input/topview3d/exports`. The **Download** button also lets you download files to your computer.
- **Save and Exit** saves a camera preview PNG and the corresponding scene JSON in `ComfyUI/input/topview3d`, and updates the node properties. It does not replace saving the ComfyUI workflow file.
- Scene data in older workflows is migrated automatically. The Builder node's legacy ports and connections are removed; its internal node ID stays unchanged.
- The preview uses the active shooting camera and the current timeline frame. If you move to another computer or delete the preview cache, open the scene and use **Save and Exit** to regenerate it.
- To hide character names or the grid, turn off character labels or the ground in the scene display settings.
- Depth, normal, and OpenPose render passes, external model import, and unattended background rendering are not included.
- Only one editor window can be open at a time. The plugin uses ComfyUI's existing Pillow and aiohttp dependencies; no additional Python packages are required.

After updating, restart ComfyUI and refresh your browser with **Ctrl+F5** to load the updated node definitions and interface.

The toolbar shows the scene name and save status on the left, aspect ratio and **Export** in the center, and **Save and Exit** on the right. Choose image or video output in the export dialog. The editor now includes grouped timeline editing, global lighting controls and the film workspace from upstream 1.0.15. Film exports use the same ComfyUI video export flow. If loading fails, click **Retry** or **Exit Without Saving**. Exiting without saving restores the Builder node's scene state from before the editor was opened.

## Installation and updates with Git

Open a terminal in `ComfyUI/custom_nodes` and run:

```sh
git clone https://github.com/gyx85542-dot/ComfyUI-Topview-3D-Builder.git
```

Restart ComfyUI and refresh your browser. No frontend build is required.

To update, open a terminal in `ComfyUI/custom_nodes` and run:

```sh
cd ComfyUI-Topview-3D-Builder
git pull --ff-only origin main
```

Then restart ComfyUI and refresh your browser.
