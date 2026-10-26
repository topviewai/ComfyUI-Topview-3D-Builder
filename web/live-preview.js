// One WebGL worker at a time across all cards; stale workers are disposed on change.
const pending = new Map();
let active = null;
function pump() {
  if(active || !pending.size)return;
  const [owner,request]=pending.entries().next().value;pending.delete(owner);
  const iframe=document.createElement('iframe');
  iframe.src=request.url;iframe.title='Topview live preview';
  iframe.setAttribute('aria-hidden','true');iframe.tabIndex=-1;
  Object.assign(iframe.style,{position:'fixed',left:'-20000px',top:'0',width:'1280px',height:'900px',border:'0',pointerEvents:'none'});
  let finished=false;
  const finish=()=>{
    if(finished)return;finished=true;clearTimeout(timer);window.removeEventListener('message',receive);iframe.remove();
    active=null;queueMicrotask(pump);
  };
  const receive=event=>{
    if(event.origin!==location.origin||event.source!==iframe.contentWindow||event.data?.source!=='topview3d-editor')return;
    const message=event.data;
    if(message.type==='ready')iframe.contentWindow.postMessage({source:'topview3d-host',type:'init',locale:request.locale,state:request.state,exportSettings:request.settings,renderJob:{id:'preview',preview:true,settings:request.settings}},location.origin);
    else if(message.type==='preview-media' && message.blob instanceof Blob) {request.done(message.blob,message.kind);finish();}
    else if(message.type==='render-error') {request.error(message.error);finish();}
  };
  const timer=setTimeout(()=>{request.error('Preview timed out. Shorten the video range and try again.');finish();},180000);
  active={owner,cancel:finish};window.addEventListener('message',receive);document.body.append(iframe);
}
export function cancelPreview(owner) {
  pending.delete(owner);
  if(active?.owner===owner)active.cancel();
}
export function requestPreview(owner,request) {
  cancelPreview(owner);pending.set(owner,request);pump();
}

export function previewSignature(state, settings) {
  const {render_id,exportSettings:unused,...scene}=state;
  const {timeUnit,...render}=settings;
  if(render.output==='image'){delete render.start;delete render.end;}
  else delete render.currentFrame;
  // Current editor frame/camera do not change an explicitly selected export view.
  delete scene.frame;delete scene.cameraId;delete scene.agentHistory;delete scene.agentGuideExpanded;
  return JSON.stringify([scene,render]);
}
