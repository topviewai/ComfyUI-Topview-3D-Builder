import asyncio
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from PIL import Image
from aiohttp import web, FormData
from aiohttp.test_utils import TestClient, TestServer

sys.modules['folder_paths']=types.SimpleNamespace(get_temp_directory=lambda:'')
sys.modules['server']=types.SimpleNamespace(PromptServer=None)
spec=importlib.util.spec_from_file_location('export_backend',Path(__file__).resolve().parents[1]/'export_backend.py')
backend=importlib.util.module_from_spec(spec);spec.loader.exec_module(backend)
state={'width':1280,'height':720,'document':{'content':{'nodes':[{'type':'camera','id':'main'}],'timeline':{'frameStart':0,'frameEnd':120}}}}
settings=dict(output='image',cameraId='main',currentFrame=0,start=0,end=12,exportHeight=720,aspectRatio='16:9')

class ExportTests(unittest.IsolatedAsyncioTestCase):
    def test_parameters(self):
        self.assertAlmostEqual(backend.validate_settings(state,json.dumps(settings))['viewportAspect'],16/9)
        for values in ({'fps':0},{'fps':121},{'fps':29.5},{'fps':True},{'cameraId':'deleted'},{'cameraId':'__editor__'},{'currentFrame':121},{'exportHeight':999},{'output':'video','start':30,'end':10}):
            with self.assertRaises(ValueError): backend.validate_settings(state,json.dumps(settings|values))

        self.assertEqual(backend.validate_settings(state,json.dumps(settings | {'fps':60}))['fps'],60)

    async def test_upload_and_errors(self):
        with tempfile.TemporaryDirectory() as root:
            backend.folder_paths.get_temp_directory=lambda:root
            routes=web.RouteTableDef();backend.register_export_routes(routes)
            app=web.Application();app.add_routes(routes)
            async with TestClient(TestServer(app)) as client:
                for width in (1280,640):
                    future=asyncio.get_running_loop().create_future()
                    backend.jobs['test']={'future':future,'loop':asyncio.get_running_loop(),'uploading':False,'settings':backend.validate_settings(state,json.dumps(settings))}
                    buffer=io.BytesIO();Image.new('RGB',(width,720)).save(buffer,format='PNG')
                    data=FormData();data.add_field('media',buffer.getvalue(),filename='frame.png')
                    response=await client.post('/topview3d/export-jobs/test',data=data)
                    if width==1280:
                        self.assertEqual(response.status,200);self.assertTrue((await future).is_file())
                    else:
                        self.assertEqual(response.status,400)
                        with self.assertRaisesRegex(ValueError,'dimensions'):await future
                self.assertEqual((await client.post('/topview3d/export-jobs/missing',json={})).status,404)
            backend.jobs.clear()

if __name__=='__main__':unittest.main()
