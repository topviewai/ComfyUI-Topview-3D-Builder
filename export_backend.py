"""Render workflow media in the requesting browser and return native Comfy types."""
import asyncio
import json
import math
import os
import secrets
import tempfile
from pathlib import Path
from aiohttp import web
import folder_paths
from server import PromptServer

jobs = {}

def validate_settings(state, raw):
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get('output') not in ('image', 'video'):
        raise ValueError('Select Image or Video in the Topview node export form.')
    if value.get('exportHeight') not in (720, 1080, 1440) or value.get('aspectRatio') not in ('auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'):
        raise ValueError('Invalid export resolution or aspect ratio')
    content = state['document']['content']
    camera = value.get('cameraId')
    if camera == '__editor__':
        if not state.get('editorView'):
            raise ValueError('Save and exit the editor to capture the current view, or select a scene camera.')
    elif not any(n.get('type') == 'camera' and n['id'] == camera for n in content['nodes']):
        raise ValueError('Export camera no longer exists; select another camera.')
    timeline = content['timeline']
    fps = value.get('fps', timeline.get('fps', 24))
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or not 1 <= fps <= 120 or fps != int(fps):
        raise ValueError('Export frame rate must be an integer between 1 and 120.')
    value['fps'] = int(fps)
    fields = ('currentFrame',) if value['output'] == 'image' else ('start', 'end')
    for name in fields:
        frame = value.get(name)
        if not isinstance(frame, int) or not timeline['frameStart'] <= frame <= timeline['frameEnd']:
            raise ValueError('Export frames must be inside the scene timeline.')
    if value['output'] == 'video' and value['start'] > value['end']:
        raise ValueError('Export start must not exceed end.')
    aspect = state.get('viewportAspect', state.get('width', 1280) / state.get('height', 720))
    if value['aspectRatio'] != 'auto':
        w, h = map(float, value['aspectRatio'].split(':')); aspect = w / h
    if not isinstance(aspect, (int, float)) or not math.isfinite(aspect) or aspect <= 0:
        raise ValueError('Invalid viewport aspect')
    value['viewportAspect'] = aspect
    return value

async def execute_export(state, raw_settings, unique_id):
    settings = validate_settings(state, raw_settings)
    server = PromptServer.instance
    client_id = server.client_id
    if not client_id:
        raise ValueError('Topview rendering needs an open ComfyUI browser. Run this workflow from the browser.')
    loop = asyncio.get_running_loop()
    identity = secrets.token_hex(32)
    future = loop.create_future()
    jobs[identity] = {'future': future, 'loop': loop, 'settings': settings, 'uploading': False}
    server.send_sync('topview3d-render-request', {'id':identity,'node':unique_id,'state':json.dumps(state),'settings':settings}, client_id)
    try:
        import comfy.model_management
        for _ in range(1800):
            done, _ = await asyncio.wait([future], timeout=1)
            comfy.model_management.throw_exception_if_processing_interrupted()
            if done: break
        else:
            raise ValueError('Topview render timed out. Keep the browser open and try a shorter video.')
        path = future.result()
        from comfy_execution.graph_utils import ExecutionBlocker
        if settings['output'] == 'image':
            import numpy as np
            import torch
            from PIL import Image
            with Image.open(path) as image:
                tensor = torch.from_numpy(np.array(image.convert('RGB'), dtype=np.float32) / 255.0).unsqueeze(0)
            return (tensor, ExecutionBlocker(None))
        from comfy_api.latest import InputImpl
        return (ExecutionBlocker(None), InputImpl.VideoFromFile(str(path)))
    finally:
        jobs.pop(identity, None)
        if not future.done(): future.cancel()
        server.send_sync('topview3d-render-finished', {'id':identity}, client_id)

def register_export_routes(routes):
    @routes.post('/topview3d/export-jobs/{identity}')
    async def upload(request):
        job = jobs.get(request.match_info['identity'])
        if not job or job['future'].done(): raise web.HTTPNotFound()
        if job['uploading']: raise web.HTTPConflict()
        job['uploading'] = True
        def complete(path=None, error=None):
            if job['future'].done(): return
            if error: job['future'].set_exception(ValueError(error))
            else: job['future'].set_result(path)
        path = None
        try:
            if request.content_type == 'application/json':
                data = await request.json()
                message = str(data.get('error', 'Browser render failed'))[:2000]
                job['loop'].call_soon_threadsafe(complete, None, message)
                return web.json_response({'ok':True})
            root = Path(folder_paths.get_temp_directory()) / 'topview3d'
            root.mkdir(parents=True, exist_ok=True)
            suffix = '.png' if job['settings']['output'] == 'image' else '.mp4'
            descriptor, name = tempfile.mkstemp(dir=root, suffix=suffix)
            path = Path(name)
            reader = await request.multipart()
            part = await reader.next()
            if not part or part.name != 'media':
                os.close(descriptor); raise ValueError('Expected rendered media')
            size = 0
            with os.fdopen(descriptor, 'wb') as stream:
                while chunk := await part.read_chunk():
                    size += len(chunk)
                    if size > 512 * 1024 * 1024: raise ValueError('Rendered media exceeds 512 MB')
                    stream.write(chunk)
            if await reader.next() is not None: raise ValueError('Unexpected export upload field')
            expected_height = job['settings']['exportHeight']
            expected_width = math.floor(expected_height * job['settings']['viewportAspect'] + .5)
            if suffix == '.png':
                from PIL import Image
                with Image.open(path) as image:
                    if image.format != 'PNG' or image.size != (expected_width, expected_height): raise ValueError('Rendered image dimensions do not match export settings')
                    image.verify()
            else:
                import av
                with av.open(str(path)) as container:
                    stream = next(iter(container.streams.video), None)
                    if stream is None or abs(stream.width - expected_width) > 1 or abs(stream.height - expected_height) > 1: raise ValueError('Invalid rendered video dimensions')
            job['loop'].call_soon_threadsafe(complete, path)
            return web.json_response({'ok':True})
        except Exception as error:
            if path: path.unlink(missing_ok=True)
            job['loop'].call_soon_threadsafe(complete, None, str(error))
            return web.json_response({'error':str(error)}, status=400)
