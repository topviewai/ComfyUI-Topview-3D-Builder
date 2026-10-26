import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

import { normalizeLocale, translate } from "./i18n.js";
import { exportSettings, makeExportForm } from './export-settings.js';
import {requestPreview,cancelPreview,previewSignature} from './live-preview.js';
let currentLocale = 'en';
const t = (key, values = {}) => translate(currentLocale, key, values);
const trackedNodes = new Set();
const iconUrl = new URL('./icon.png', import.meta.url).href;
const titleIcon = new Image();
titleIcon.src = iconUrl;
titleIcon.onload = () => app.canvas?.setDirty(true, true);
function fitCard(node) {
  if (!node._topviewBox || node._topviewSizing) return;
  node._topviewSizing = true;
  const width = Math.max(340, node.size[0]);
  node._topviewHeight = node._topviewAspect
    ? width / node._topviewAspect
    : 176;
  node.setSize([width, node._topviewHeight + (node._topviewFormHeight || 254) + 92]);
  node._topviewSizing = false;
  app.canvas?.setDirty(true, true);
}
const videoOverrides = new WeakMap();
function restoreVideoLayout(node) {
  const saved = videoOverrides.get(node);
  if (!saved) return;
  if (saved.widget.computeLayoutSize === saved.override) {
    if (saved.own) saved.widget.computeLayoutSize = saved.original;
    else delete saved.widget.computeLayoutSize;
  }
  saved.video.removeEventListener('pointerdown', saved.drag, true);
  saved.video.style.cssText = saved.style;
  saved.video.draggable = saved.draggable;
  videoOverrides.delete(node);
}
// Restrict native media adjustments to files produced by this extension.
function fitExportedVideo(node) {
  const file = node.widgets?.find((w) => w.name === 'file')?.value;
  if (typeof file !== 'string' || !file.startsWith('topview3d/exports/')) { restoreVideoLayout(node); return; }
  const widget = node.widgets?.find((w) => w.name === 'video-preview');
  const video = node.videoContainer?.querySelector('video');
  if (!widget || !video?.videoWidth || !video.videoHeight) return;
  const margin = widget.margin ?? 10;
  const height = (node.size[0] - margin * 2) * video.videoHeight / video.videoWidth + margin * 2;
  let saved = videoOverrides.get(node);
  if (saved && (saved.widget !== widget || saved.video !== video)) { restoreVideoLayout(node); saved = null; }
  if (!saved) {
    const drag = (event) => {
      const currentFile = node.widgets?.find((w) => w.name === 'file')?.value;
      if (!currentFile?.startsWith('topview3d/exports/')) { restoreVideoLayout(node); return; }
      const rect = video.getBoundingClientRect();
      const controlsHeight = 48 * (rect.width / Math.max(1, video.clientWidth));
      if (event.button !== 0 || event.clientY >= rect.bottom - controlsHeight || document.fullscreenElement) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      app.canvas?.canvas.dispatchEvent(new PointerEvent(event.type, event));
    };
    saved = {widget, video, original:widget.computeLayoutSize, own:Object.hasOwn(widget, 'computeLayoutSize'), style:video.style.cssText, draggable:video.draggable, drag};
    saved.override = () => {
      const h = (node.size[0] - margin * 2) * video.videoHeight / video.videoWidth + margin * 2;
      return {minHeight:h, maxHeight:h, minWidth:0};
    };
    videoOverrides.set(node, saved);
    widget.computeLayoutSize = saved.override;
    Object.assign(video.style, {width:'100%',height:'100%',objectFit:'contain',userSelect:'none'});
    video.draggable = false;
    video.addEventListener('pointerdown', drag, true);
  }
  const target = widget.y + height + 4;
  if (Math.abs(node.size[1] - target) > 0.5) node.setSize([node.size[0], target]);
}

function syncLocale() {
  const next = normalizeLocale(app.extensionManager?.setting?.get('Comfy.Locale') || app.ui?.settings?.getSettingValue('Comfy.Locale') || document.documentElement.lang || navigator.language);
  if (next === currentLocale) return;
  currentLocale = next;
  for (const node of trackedNodes) {
    if (node._topviewOpen) node._topviewOpen.name = t('open');
    if (node._topviewImage) updatePreview(node);
    node._topviewForm?.refresh();
  }
  if (activeEditor) {
    activeEditor.title = t('editor');
    activeEditor.contentWindow?.postMessage({source:'topview3d-host',type:'locale',locale:currentLocale},location.origin);
  }
  app.canvas?.setDirty(true,true);
}
let activeEditor = null;
const url = (path) => api.apiURL(path);

function stateOf(node) {
  node.properties ||= {};
  return {
    get value() { return node.properties.topview_scene_state || ""; },
    set value(raw) { node.properties.topview_scene_state = raw; },
  };
}
function parsedState(node) { try { return JSON.parse(stateOf(node).value || '{}'); } catch { return {}; } }
function settingsOf(node) { return exportSettings(parsedState(node), node.properties?.topview_export_settings || parsedState(node).exportSettings); }
function syncMediaOutput(node, kind) {
  const type = kind === 'video' ? 'VIDEO' : 'IMAGE';
  // Keep the matching socket when migrating old two-output workflows.
  const matching = node.outputs?.findIndex(output => output.type === type) ?? -1;
  for (let index = (node.outputs?.length || 0) - 1; index >= 0; index--) {
    if (index !== matching) node.removeOutput(index);
  }
  if (!node.outputs?.length) node.addOutput(kind, type);
  const output = node.outputs[0];
  output.name = kind; output.label = kind; output.type = type;
  delete output.color_on; delete output.color_off;
}
function setSettings(node, settings) {
  node.properties.topview_export_settings = exportSettings(parsedState(node), settings);
  syncMediaOutput(node, node.properties.topview_export_settings.output);
  updatePreview(node); fitCard(node); app.graph?.change?.(); app.canvas?.setDirty(true,true);
}

const renderFrames = new Map();
function startWorkflowRender(job) {
  if(renderFrames.has(job.id)) return;
  const iframe=document.createElement('iframe');
  iframe.src=url('/topview3d/editor/index.html');
  iframe.title='Topview workflow renderer';
  // Keep a real sized WebGL surface; display:none prevents viewport initialization.
  Object.assign(iframe.style,{position:'fixed',left:'-20000px',top:'0',width:'1280px',height:'900px',border:'0',pointerEvents:'none'});
  const cleanup=()=>{window.removeEventListener('message',receive);iframe.remove();renderFrames.delete(job.id)};
  const fail=async(error)=>{try{await api.fetchApi(`/topview3d/export-jobs/${job.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({error})})}finally{cleanup()}};
  const receive=event=>{
    if(event.origin!==location.origin||event.source!==iframe.contentWindow||event.data?.source!=='topview3d-editor')return;
    const message=event.data;
    if(message.type==='ready') iframe.contentWindow.postMessage({source:'topview3d-host',type:'init',locale:currentLocale,state:job.state,exportSettings:job.settings,renderJob:job},location.origin);
    else if(message.type==='render-error') void fail(message.error);
    else if(message.type==='render-complete') cleanup();
  };
  renderFrames.set(job.id,cleanup);window.addEventListener('message',receive);document.body.append(iframe);
}

function migrateNode(node, info) {
  if (!stateOf(node).value) {
    const legacy = node.widgets?.find((w) => w.name === "scene_state")?.value
      || info?.widgets_values?.find((value) => typeof value === "string" && value.startsWith('{'));
    if (legacy) stateOf(node).value = legacy;
  }
  // Keep the new typed sockets and existing downstream connections intact.
  for (const widget of node.widgets || []) {
    if (!['scene_state', 'export_settings'].includes(widget.name)) continue;
    widget.type = 'hidden';
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({minHeight:0,maxHeight:0,minWidth:0});
    if (widget.inputEl) widget.inputEl.style.display = 'none';
    widget.serializeValue = () => widget.name === 'scene_state' ? stateOf(node).value : JSON.stringify(settingsOf(node));
  }
  syncMediaOutput(node, settingsOf(node).output);
}

function updatePreview(node) {
  if(!node._topviewBox)return;
  const state=parsedState(node),settings=settingsOf(node);
  const key=previewSignature(state,settings);
  if(node._topviewPreviewKey===key)return;
  node._topviewPreviewKey=key;
  clearTimeout(node._topviewPreviewTimer);cancelPreview(node);
  const video=node._topviewVideo,image=node._topviewImage,status=node._topviewStatus;
  video.pause();video.removeAttribute('src');video.load();video.style.display='none';image.style.display='none';
  if(node._topviewObjectUrl){URL.revokeObjectURL(node._topviewObjectUrl);delete node._topviewObjectUrl;}
  const aspect=settings.aspectRatio==='auto'?settings.viewportAspect:settings.aspectRatio.split(':').reduce((a,b)=>Number(a)/Number(b));
  node._topviewAspect=aspect;fitCard(node);
  status.style.display='block';
  if(!state.document){image.src=iconUrl;image.style.cssText='display:block;width:96px;height:96px;object-fit:contain';status.textContent=t('pending');return;}
  status.textContent=currentLocale.startsWith('zh')?'正在更新预览…':'Updating preview…';
  node._topviewPreviewTimer=setTimeout(()=>requestPreview(node,{
    url:url('/topview3d/editor/index.html'),locale:currentLocale,state:JSON.stringify(state),settings,
    done(blob,kind){
      if(node._topviewPreviewKey!==key)return;
      const source=node._topviewObjectUrl=URL.createObjectURL(blob);
      status.style.display='none';
      if(kind==='video') {video.src=source;video.style.display='block';void video.play().catch(()=>{});}
      else {image.src=source;image.style.cssText='display:block;width:100%;height:100%;object-fit:contain';}
      fitCard(node);
    },
    error(error){if(node._topviewPreviewKey===key){status.textContent=String(error);status.style.display='block';node._topviewPreviewKey=null;}}
  }),400);
}

function openEditor(node) {
  syncLocale();
  if (activeEditor) { activeEditor.focus(); return; }
  const initialState = stateOf(node).value;
  const initialSettings = structuredClone(settingsOf(node));
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {position:"fixed", inset:"0", zIndex:"100000", background:"#0009", display:"grid", placeItems:"center"});
  const iframe = document.createElement("iframe");
  iframe.title = t('editor');
  iframe.dataset.topviewEditor = 'true';
  iframe.src = url("/topview3d/editor/index.html");
  Object.assign(iframe.style, {width:"90vw",height:"90vh",border:"1px solid #444",borderRadius:"12px",boxShadow:"0 24px 80px #0009",background:"#16171b"});
  overlay.append(iframe);
  const close = () => {
    window.removeEventListener("message", receive);
    overlay.remove(); activeEditor = null;
    delete node._topviewClose;
  };
  const receive = (event) => {
    if (event.origin !== location.origin || event.source !== iframe.contentWindow) return;
    const message = event.data;
    if (message?.source !== "topview3d-editor") return;
    if (message.type === "ready") {
      iframe.contentWindow.postMessage({source:"topview3d-host", type:"init", locale:currentLocale, state:stateOf(node).value, exportSettings:settingsOf(node)}, location.origin);
    } else if (message.type === "state" && typeof message.state === "string") {
      stateOf(node).value = message.state;
      node._topviewForm?.refresh();
      updatePreview(node);
      app.graph?.change?.();
      app.canvas?.setDirty(true, true);
    } else if (message.type === 'export-settings') {
      setSettings(node,message.settings); node._topviewForm?.refresh();
    } else if (message.type === "media") {
      let created;
      try {
        const kind = message.kind === "video" ? "LoadVideo" : "LoadImage";
        created = globalThis.LiteGraph.createNode(kind);
        if (!created) throw new Error(t('missingNode',{detail:kind}));
        const widget = created.widgets?.find((w) => w.name === (kind === "LoadVideo" ? "file" : "image"));
        if (!widget) throw new Error(t('missingInput',{detail:kind}));
        const file = message.file;
        if (file?.type !== "input" || typeof file.name !== "string" || typeof file.subfolder !== "string") throw new Error(t('invalidMedia'));
        const filename = file.subfolder ? `${file.subfolder}/${file.name}` : file.name;
        const offset = node._topviewExportCount || 0;
        created.pos = [node.pos[0] + node.size[0] + 70, node.pos[1] + offset * 100];
        created.title = `Topview 3D Builder · ${t(kind === 'LoadVideo' ? 'video' : 'image')}`;
        app.graph.add(created);
        if (Array.isArray(widget.options?.values) && !widget.options.values.includes(filename)) widget.options.values.push(filename);
        widget.value = filename;
        widget.callback?.(filename);
        node._topviewExportCount = offset + 1;
        app.graph.change?.(); app.canvas?.setDirty(true, true);
        iframe.contentWindow.postMessage({source:"topview3d-host",requestId:message.requestId},location.origin);
      } catch (error) {
        if (created?.graph) app.graph.remove(created);
        iframe.contentWindow.postMessage({source:"topview3d-host",requestId:message.requestId,error:String(error)},location.origin);
      }
    } else if (message.type === "discard") {
      stateOf(node).value = initialState;
      setSettings(node,initialSettings); node._topviewForm?.refresh();
      updatePreview(node);
      app.graph?.change?.();
      close();
    } else if (message.type === "close") close();
  };
  window.addEventListener("message", receive);
  node._topviewClose = close;
  document.body.append(overlay);
  activeEditor = iframe;
}

app.registerExtension({
  name: "Topview.3D.Builder",
  async addCustomNodeDefs(defs) {
    const def = defs.Topview3DScene;
    if (def) { def.display_name = 'Topview 3D Builder'; def.category = 'Topview'; }
  },
  setup() {
    api.addEventListener('topview3d-render-request',event=>startWorkflowRender(event.detail));
    api.addEventListener('topview3d-render-finished',event=>renderFrames.get(event.detail.id)?.());
    const style = document.createElement('style');
    style.textContent = '[data-topview-passive], [data-topview-passive] * { pointer-events: none !important; user-select: none !important; -webkit-user-drag: none; }';
    style.textContent += `.litemenu-entry.topview-category-icon::before { content: ""; display: inline-block; width: 16px; height: 16px; margin-right: 6px; vertical-align: -3px; border-radius: 4px; background: url("${iconUrl}") center / contain no-repeat; pointer-events: none; }`;
    style.textContent += `
      .topview-library-label::before {
        content:""; display:inline-block; width:16px; height:16px;
        margin-inline-end:6px; vertical-align:-3px; border-radius:4px;
        background:url("${iconUrl}") center / contain no-repeat;
        pointer-events:none; user-select:none;
      }
    `;
    document.head.append(style);
    // Decorate only our category, keeping the original menu entry and callback.
    const decorate = (element) => {
      if (!(element instanceof Element)) return;
      const entries = element.matches('.litemenu-entry') ? [element] : element.querySelectorAll('.litemenu-entry');
      for (const entry of entries) {
        if (entry.value?.value === 'Topview/') entry.classList.add('topview-category-icon');
      }
    };
    const decorateLibrary = (element) => {
      if (!(element instanceof Element)) return;
      const selector = '[role="treeitem"]';
      const rows = new Set(element.querySelectorAll(selector));
      const row = element.closest(selector);
      if (row) rows.add(row);
      for (const item of rows) {
        // Decorate the label only. Native folder icons and expand controls
        // remain untouched; unknown label structures safely keep the native UI.
        const label = item.querySelector(':scope > span, :scope > .p-tree-node-content [data-folder-name], :scope > .p-tree-node-content [data-node-name]');
        for (const old of item.querySelectorAll('.topview-library-label')) {
          if (old.closest('[role="treeitem"]') === item && old !== label) old.classList.remove('topview-library-label');
        }
        const name = label?.textContent.trim();
        label?.classList.toggle('topview-library-label', name === 'Topview' || name === 'Topview 3D Builder');
      }
    };
    // Observe only mounted node libraries and context menus. A cheap root scan
    // discovers replacements without subscribing to canvas/editor mutations.
    const roots = new Map();
    const discover = () => {
      for (const [root, observer] of roots) {
        if (!root.isConnected) { observer.disconnect(); roots.delete(root); }
      }
      for (const root of document.querySelectorAll('[role="tree"], .p-tree, .litecontextmenu')) {
        if (roots.has(root)) continue;
        let queued = false;
        const refresh = () => { decorate(root); decorateLibrary(root); };
        const observer = new MutationObserver(() => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => { queued = false; if (root.isConnected) refresh(); });
        });
        observer.observe(root, {childList:true, characterData:true, subtree:true});
        roots.set(root, observer);
        refresh();
      }
    };
    discover();
    setInterval(discover, 500);
    syncLocale(); setInterval(syncLocale, 500);
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name === 'Topview3DScene' || nodeData.name === 'LoadVideo') {
      const hitTest = nodeType.prototype.getWidgetOnPos;
      nodeType.prototype.getWidgetOnPos = function () {
        const widget = hitTest?.apply(this, arguments);
        if (widget?.name === 'topview_preview') return undefined;
        const file = this.widgets?.find((w) => w.name === 'file')?.value;
        if (widget?.name === 'video-preview' && typeof file === 'string' && file.startsWith('topview3d/exports/')) return undefined;
        return widget;
      };
    }
    if (nodeData.name === 'LoadVideo') {
      const removed = nodeType.prototype.onRemoved;
      nodeType.prototype.onRemoved = function () { restoreVideoLayout(this); return removed?.apply(this, arguments); };
      const draw = nodeType.prototype.onDrawForeground;
      nodeType.prototype.onDrawForeground = function () {
        draw?.apply(this, arguments);
        fitExportedVideo(this);
      };
    }
    if (nodeData.name !== "Topview3DScene") return;
    nodeData.display_name = 'Topview 3D Builder';
    nodeData.category = 'Topview';
    nodeType.category = 'Topview';
    nodeType.title = 'Topview 3D Builder';
    const drawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      drawForeground?.apply(this, arguments);
      if (titleIcon.complete && titleIcon.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(8, -25, 20, 20, 4);
        ctx.clip();
        ctx.drawImage(titleIcon, 8, -25, 20, 20);
        ctx.restore();
      }
    };
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      created?.apply(this, arguments);
      this.title = "Topview 3D Builder";
      migrateNode(this);
      syncLocale();
      trackedNodes.add(this);
      this._topviewOpen = this.addWidget("button", t('open'), null, () => openEditor(this), {serialize:false});
      this._topviewForm = makeExportForm(this,()=>parsedState(this),()=>settingsOf(this),value=>setSettings(this,value),()=>currentLocale.startsWith('zh'));
      setSettings(this,settingsOf(this));
      const box = this._topviewBox = document.createElement("div");
      box.dataset.topviewPreview = 'true';
      Object.assign(box.style, {padding:"0",color:"#bbb",height:"100%",boxSizing:"border-box",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden",userSelect:"none"});
      this._topviewImage = document.createElement("img");
      Object.assign(this._topviewImage.style, {display:"block",objectFit:"contain",flexShrink:"0"});
      this._topviewImage.alt = 'Topview 3D Builder';
      this._topviewImage.dataset.topviewPassive='true';
      this._topviewImage.draggable = false;
      this._topviewImage.onload = () => {
        fitCard(this);
      };
      this._topviewStatus = document.createElement("div");
      this._topviewStatus.style.cssText = "font:12px sans-serif;text-align:center;padding:6px;line-height:1.6";
      const video=this._topviewVideo=document.createElement('video');
      video.controls=true;video.muted=true;video.loop=true;video.playsInline=true;
      video.style.cssText='display:none;width:100%;height:100%;object-fit:contain';
      this._topviewStatus.dataset.topviewPassive='true';
      box.append(this._topviewImage,video,this._topviewStatus);
      this.addDOMWidget("topview_preview", "preview", box, {serialize:false, hideOnZoom:false, margin:0, getMinHeight:()=>this._topviewHeight || 176, getMaxHeight:()=>this._topviewHeight || 176, afterResize:()=>fitCard(this)});
      this.setSize([340, 220]);
      updatePreview(this);
    };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      configured?.apply(this, arguments);
      migrateNode(this, arguments[0]);
      this._topviewForm?.refresh(); setSettings(this,settingsOf(this));
      if (this.title === "Topview 3D Scene") this.title = "Topview 3D Builder";
      if (this._topviewImage) updatePreview(this);
    };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      trackedNodes.delete(this);
      clearTimeout(this._topviewPreviewTimer);cancelPreview(this);this._topviewVideo?.pause();
      if(this._topviewObjectUrl)URL.revokeObjectURL(this._topviewObjectUrl);
      this._topviewClose?.();
      return removed?.apply(this, arguments);
    };
  },
});
