import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parents[1]
sys.modules['folder_paths'] = types.SimpleNamespace(get_user_directory=lambda: '')
spec = importlib.util.spec_from_file_location('agent_backend', ROOT / 'agent_backend.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)

class AgentTests(unittest.IsolatedAsyncioTestCase):
    async def test_routes_and_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            backend.folder_paths.get_user_directory = lambda: directory
            received = []
            async def complete(request):
                self.assertEqual(request.headers['Authorization'], 'Bearer test-secret')
                received.append(await request.json())
                return web.json_response({'choices': [{'message': {'role': 'assistant', 'content': 'ok'}, 'finish_reason': 'stop'}]})
            provider = web.Application()
            provider.router.add_post('/v1/chat/completions', complete)
            async def models(request):
                self.assertEqual(request.headers['Authorization'], 'Bearer test-secret')
                return web.json_response({'data': [{'id': 'mock-model'}, {'id': 'other-model'}]})
            provider.router.add_get('/v1/models', models)
            async with TestServer(provider) as remote:
                routes = web.RouteTableDef()
                backend.register_agent_routes(routes)
                app = web.Application(); app.add_routes(routes)
                async with TestClient(TestServer(app)) as client:
                    headers = {'X-Topview-Agent-Session': 'a' * 64}
                    profile = {'id': 'qwen', 'provider': 'qwen-cn', 'model': 'mock-model', 'api_key': 'test-secret', 'base_url': str(remote.make_url('/v1'))}
                    response = await client.post('/topview3d/agent/models', json={'draft': {**profile, 'model': ''}}, headers=headers)
                    self.assertEqual(response.status, 200)
                    self.assertEqual((await response.json())['models'], ['mock-model', 'other-model'])
                    config_response = await client.get('/topview3d/agent/config', headers=headers)
                    self.assertEqual((await config_response.json())['profiles'], [])
                    self.assertEqual(list(Path(directory).rglob('*.json')), [])
                    response = await client.post('/topview3d/agent/save', json=profile, headers=headers)
                    self.assertEqual(response.status, 200)
                    public = await response.json()
                    self.assertNotIn('test-secret', json.dumps(public))
                    self.assertTrue(public['profiles'][0]['has_key'])
                    stored = json.loads(next(Path(directory).rglob('*.json')).read_text(encoding='utf-8'))
                    self.assertEqual(backend.protect_key(stored['profiles'][0]['secret'], decrypt=True), 'test-secret')
                    if sys.platform == 'win32': self.assertNotEqual(stored['profiles'][0]['secret'], 'test-secret')
                    response = await client.get('/topview3d/agent/config', headers={'X-Topview-Agent-Session': 'b' * 64})
                    self.assertEqual((await response.json())['profiles'], [])
                    response = await client.post('/topview3d/agent/complete', json={'messages': [{'role': 'user', 'content': 'test'}], 'tools': []}, headers=headers)
                    self.assertEqual(response.status, 200)
                    self.assertFalse(received[-1]['enable_thinking'])
                    profile.update(api_key='', base_url='https://example.com/v1')
                    response = await client.post('/topview3d/agent/save', json=profile, headers=headers)
                    self.assertEqual(response.status, 400)
                    response = await client.get('/topview3d/agent/config', headers={**headers, 'Origin': 'https://other.example'})
                    self.assertEqual(response.status, 400)
        self.assertEqual(backend.completion_payload({'model': 'test', 'provider': 'deepseek'}, [], [])['thinking'], {'type': 'disabled'})
        with self.assertRaises(backend.AgentError): backend.base_url('http://remote.example/v1')

if __name__ == '__main__': unittest.main()
