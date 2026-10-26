import assert from 'node:assert/strict'
import {exportSettings,makeExportForm} from '../web/export-settings.js'
import {previewSignature} from '../web/live-preview.js'
const state={frame:20,width:1280,height:720,document:{content:{nodes:[{id:'main',type:'camera',camera:{aspectRatio:'16:9'}}],timeline:{frameStart:5,frameEnd:120,fps:24}}}}
const defaults=exportSettings(state)
assert.equal(defaults.cameraId,'main');assert.equal(defaults.currentFrame,20)
const video=exportSettings(state,{...defaults,output:'video',timeUnit:'seconds',start:24,end:48})
assert.equal(video.start,24);assert.equal(video.end,48);assert.equal(video.timeUnit,'seconds')
assert.equal(exportSettings(state,{currentFrame:999}).currentFrame,120)
assert.equal(exportSettings(state,{cameraId:'deleted'}).cameraId,'main')
assert.equal(exportSettings(state,{cameraId:'__editor__'}).cameraId,'__editor__')
assert.equal(exportSettings(state,{start:60,end:30}).end,60)
console.log('Export settings passed: camera selection, frame/second storage, range bounds and image/video switching.')
let selected=defaults
const node={widgets:[],size:[380,400],addWidget(type,name,value,callback,options){const w={type,name,value,callback,options};this.widgets.push(w);return w},computeSize(){return [210,400]},setSize(size){this.size=size}}
node._topviewOpen=node.addWidget('button','Open',null,()=>{},{});
const form=makeExportForm(node,()=>state,()=>selected,value=>{selected=exportSettings(state,value)},()=>false)
assert.equal(node.size[0],380)
assert.ok(node.widgets.every(w=>['button','combo','number'].includes(w.type)))
node.widgets.find(w=>w.name==='Export type').callback('Video')
assert.equal(selected.output,'video');assert.ok(node.widgets.some(w=>w.name==='End'))
assert.ok(!node.widgets.some(w=>w.name==='Current frame'))
node.widgets.find(w=>w.name==='Time unit').callback('Seconds')
node.widgets.find(w=>w.name==='End').callback(3)
assert.equal(selected.end,72)
node.widgets.find(w=>w.name==='Frame rate').callback(30)
assert.equal(selected.fps,30)
assert.equal(node.widgets.find(w=>w.name==='End').value,2.4)
assert.equal(selected.end,72)
assert.equal(exportSettings(state,{fps:999}).fps,120)
assert.equal(exportSettings(state,{fps:-1}).fps,1)
const signature=previewSignature(state,selected)
assert.equal(signature,previewSignature({...state,agentGuideExpanded:false},selected))
assert.equal(signature,previewSignature({...state,agentHistory:[{role:'user',content:'hello'}]},selected))
assert.equal(signature,previewSignature({...state,render_id:'preview-only'}, {...selected,timeUnit:'frames'}))
for(const change of [{fps:60},{output:'image'},{cameraId:'__editor__'},{end:96},{exportHeight:1440},{aspectRatio:'1:1'}]) assert.notEqual(signature,previewSignature(state,{...selected,...change}))
assert.notEqual(signature,previewSignature({...state,fcurves:{userKeys:{}}},selected))
form.refresh();assert.equal(node.widgets.filter(w=>w.name==='Export type').length,1)
console.log('Native controls and preview invalidation passed: camera/type/range/resolution/aspect/scene changes; display-only unit changes preserve preview.')
