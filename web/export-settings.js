export const resolutions = [720, 1080, 1440];
export const aspects = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export function exportSettings(state, raw = {}) {
  const doc = state?.document?.content;
  const cameras = doc?.nodes?.filter(n => n.type === 'camera') || [];
  const timeline = doc?.timeline || {frameStart:0,frameEnd:119,fps:24};
  const cameraId = raw.cameraId === '__editor__' || cameras.some(c => c.id === raw.cameraId)
    ? raw.cameraId : cameras.find(c => c.id === state?.cameraId)?.id || cameras[0]?.id || '__editor__';
  const clamp = n => Math.max(timeline.frameStart, Math.min(timeline.frameEnd, Math.round(Number(n) || 0)));
  const start = clamp(raw.start ?? timeline.frameStart);
  return {output:raw.output === 'video' ? 'video' : 'image', cameraId,
    timeUnit:raw.timeUnit === 'seconds' ? 'seconds' : 'frames',
    fps:Math.max(1,Math.min(120,Math.round(Number(raw.fps ?? timeline.fps) || 24))),
    currentFrame:clamp(raw.currentFrame ?? state?.frame ?? 0), start, end:Math.max(start,clamp(raw.end ?? timeline.frameEnd)),
    exportHeight:resolutions.includes(Number(raw.exportHeight)) ? Number(raw.exportHeight) : 1080,
    aspectRatio:aspects.includes(raw.aspectRatio) ? raw.aspectRatio : cameras.find(c => c.id === cameraId)?.camera?.aspectRatio || doc?.aspectRatio || 'auto',
    viewportAspect:state?.viewportAspect || state?.width / state?.height || 21 / 9};
}

export function makeExportForm(node, getState, getSettings, update, zh) {
  const widgets = new Map();
  function refresh() {
    const state = getState(), settings = exportSettings(state, getSettings());
    const text = (cn,en) => zh() ? cn : en;
    const fps = settings.fps;
    const timeline = state?.document?.content?.timeline || {frameStart:0,frameEnd:119};
    const active = [];
    function widget(key,type,label,value,callback,options) {
      let w=widgets.get(key);
      if(!w) { w=node.addWidget(type,label,value,callback,{...options,serialize:false});widgets.set(key,w); }
      w.name=label;w.label=label;w.value=value;w.callback=callback;w.options={...options,serialize:false};active.push(w);
    }
    function combo(key,label,pairs) {
      // Display names are native combo values; the serialized settings retain stable IDs.
      const labels=pairs.map(p=>p[1]);
      widget(key,'combo',label,pairs.find(p=>String(p[0])===String(settings[key]))?.[1] || labels[0],value=>{
        const chosen=pairs.find(p=>p[1]===value);if(chosen) {update({...getSettings(),[key]:chosen[0]});refresh();}
      },{values:labels});
    }
    combo('output',text('导出类型','Export type'),[['image',text('图片','Image')],['video',text('视频','Video')]]);
    const cameras=(state?.document?.content?.nodes || []).filter(n=>n.type==='camera');
    combo('cameraId',text('机位','Camera'),[['__editor__',text('当前视角','Current view')],...cameras.map(n=>[n.id,cameras.filter(c=>c.name===n.name).length>1?`${n.name} (${n.id})`:n.name])]);
    combo('timeUnit',text('时间单位','Time unit'),[['frames',text('帧','Frames')],['seconds',text('秒','Seconds')]]);
    if(settings.output==='video')widget('fps','number',text('帧率','Frame rate'),fps,value=>{
      update({...getSettings(),fps:Number(value)});refresh();
    },{min:1,max:120,step:10,precision:0});
    const seconds=settings.timeUnit==='seconds';
    const factor=seconds?fps:1;
    function number(key,label) {
      const display=seconds?Number((settings[key]/factor).toFixed(1)):settings[key];
      widget(key,'number',label,display,value=>{
        const input=seconds?Math.round(Number(value)*10)/10:Number(value);
        update({...getSettings(),[key]:Math.round(input*factor)});refresh();
      },{min:timeline.frameStart/factor,max:timeline.frameEnd/factor,step:seconds?1:10,precision:seconds?1:0});
    }
    if(settings.output==='image')number('currentFrame',text('当前帧','Current frame'));
    else {number('start',text('开始','Start'));number('end',text('结束','End'));}
    const ratio=settings.aspectRatio==='auto'?settings.viewportAspect:settings.aspectRatio.split(':').reduce((a,b)=>Number(a)/Number(b));
    combo('exportHeight',text('分辨率','Resolution'),resolutions.map(h=>[h,`${h}p · ${Math.round(h*ratio)} × ${h}`]));
    combo('aspectRatio',text('画幅比例','Aspect ratio'),aspects.map(a=>[a,a==='auto'?text('自动','Auto'):a]));
    const other=node.widgets.filter(w=>![...widgets.values()].includes(w));
    const index=other.indexOf(node._topviewOpen)+1;
    other.splice(index,0,...active);node.widgets=other;
    node._topviewFormHeight=active.length*24;
    node.setSize([Math.max(node.size[0],340),node.computeSize()[1]]);
  }
  refresh();return {refresh};
}
