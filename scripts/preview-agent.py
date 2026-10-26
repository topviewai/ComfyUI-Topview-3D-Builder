"""Isolated UI preview, without restarting ComfyUI or storing real keys."""
import importlib.util
import sys
import tempfile
import types
from pathlib import Path
from aiohttp import web

root = Path(__file__).resolve().parents[1]
temporary = tempfile.TemporaryDirectory()
sys.modules['folder_paths'] = types.SimpleNamespace(get_user_directory=lambda: temporary.name)
spec = importlib.util.spec_from_file_location('agent_backend', root / 'agent_backend.py')
backend = importlib.util.module_from_spec(spec); spec.loader.exec_module(backend)
routes = web.RouteTableDef(); backend.register_agent_routes(routes)
app = web.Application(); app.add_routes(routes)
async def index(request):
    return web.Response(content_type='text/html', text='''<!doctype html><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe src="/topview3d/editor/index.html"></iframe><script>addEventListener('message',e=>{if(e.data.type==='ready')e.source.postMessage({source:'topview3d-host',type:'init',locale:'zh-CN',state:''},location.origin)})</script>''')
app.router.add_get('/', index)
app.router.add_static('/topview3d/editor/', root / 'editor')
app.router.add_static('/topview3d/assets/', root / 'assets')
web.run_app(app, host='127.0.0.1', port=8191)
