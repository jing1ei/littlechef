"""littlechef release regressions: local startup, compatibility and data integrity."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TEMP = tempfile.TemporaryDirectory(prefix='littlechef-release-')
os.environ.update(LITTLE_CHEF_DATA_DIR=str(Path(TEMP.name)/'notebook'), LITTLE_CHEF_EDIT_PIN='', LITTLE_CHEF_READ_ONLY='0')
from fastapi.testclient import TestClient
from app import settings, store
from app.main import app


class ReleaseTests(unittest.TestCase):
    def setUp(self): self.client=TestClient(app)

    def test_concurrent_new_records_have_distinct_ids(self):
        def create(_):
            result=self.client.post('/api/recipes',json={'title':'相同名字','subtitle':'same title'})
            self.assertEqual(result.status_code,200)
            return result.json()['id']
        with ThreadPoolExecutor(max_workers=12) as pool: ids=list(pool.map(create,range(40)))
        self.assertEqual(len(set(ids)),40)
        self.assertTrue(all(store.get_item('recipes',id) for id in ids))

    def test_malformed_inputs_do_not_write(self):
        bad=[{'time':'wrong'},{'servings':-2},{'course_role':[{}]}, {'tags':{'main':'wrong'}},
             {'ingredients':[{'name':8}]},{'log':[{'date':'2026-02-30'}]}, {'original_image':'../outside'}]
        for value in bad:
            response=self.client.post('/api/recipes',json={'id':'must-not-write',**value})
            self.assertEqual(response.status_code,400,response.text)
        self.assertIsNone(store.get_item('recipes','must-not-write'))
        result=self.client.post('/api/import',json={'recipes':[{'id':'import-must-not-write'}],'taxonomy':{'facets':'bad'}})
        self.assertEqual(result.status_code,400)
        self.assertIsNone(store.get_item('recipes','import-must-not-write'))

    def test_invalid_settings_are_atomic(self):
        before=settings.snapshot()
        for payload in [{'sd_cfg':'NaN'},{'sd_steps':-3},{'image_provider':'invalid'},{'read_only':'surprise'}, {'vision_api_key':{}}]:
            response=self.client.post('/api/settings',json={'house_name':'Should not save',**payload})
            self.assertEqual(response.status_code,400,response.text)
            self.assertEqual(settings.snapshot(),before)

    def test_stock_and_log_types(self):
        recipe=self.client.get('/api/recipes').json()[0]
        for payload in [{'note':3},{'rating':8},{'changed':'oops'},{'date':'not-date'}]:
            self.assertEqual(self.client.post('/api/recipes/'+recipe['id']+'/log',json=payload).status_code,400)
        item=self.client.get('/api/pantry').json()[0]
        self.assertEqual(self.client.post('/api/pantry/'+item['id']+'/stock',json={'in_stock':'false'}).status_code,400)

    def test_failed_atomic_replace_preserves_previous_file(self):
        path=Path(TEMP.name)/'atomic file.json'
        store.write_json(str(path),{'before':1})
        with patch('app.store.os.replace',side_effect=OSError('disk error')):
            with self.assertRaises(OSError):store.write_json(str(path),{'after':2})
        self.assertEqual(json.loads(path.read_text()),{'before':1})
        self.assertEqual(list(path.parent.glob('.write-*')),[])
        self.assertEqual(path.stat().st_mode & 0o777,0o600)

    def test_dotenv_is_data_not_shell_and_preserves_unicode(self):
        spec=importlib.util.spec_from_file_location('launch',ROOT/'scripts/launch.py')
        launch=importlib.util.module_from_spec(spec);spec.loader.exec_module(launch)
        folder=Path(TEMP.name)/'含 空格 路径';folder.mkdir(exist_ok=True)
        marker=folder/'must-not-exist'
        config=folder/'.env'
        config.write_text('LITTLE_CHEF_HOUSE_NAME="小厨师 家庭"\nLITTLE_CHEF_VISION_API_KEY="$(touch '+str(marker)+')"\n')
        with patch.dict(os.environ,{},clear=True):
            launch.load_environment(config)
            self.assertEqual(os.environ['LITTLE_CHEF_HOUSE_NAME'],'小厨师 家庭')
            self.assertIn('$(touch',os.environ['LITTLE_CHEF_VISION_API_KEY'])
        self.assertFalse(marker.exists())

    def test_legacy_environment_alias_and_new_precedence(self):
        with patch.dict(os.environ,{'KITCHEN_HOUSE_NAME':'Legacy'},clear=True):
            from app.environment import apply_legacy_aliases
            apply_legacy_aliases()
            self.assertEqual(os.environ['LITTLE_CHEF_HOUSE_NAME'],'Legacy')
            os.environ['LITTLE_CHEF_HOUSE_NAME']='New';apply_legacy_aliases()
            self.assertEqual(os.environ['LITTLE_CHEF_HOUSE_NAME'],'New')

    def test_photo_upload_rejects_disguised_files(self):
        recipe=self.client.get('/api/recipes').json()[0]
        response=self.client.post('/api/images/upload',data={'id':recipe['id'],'kind':'recipe'},files={'file':('bad.jpg',b'not an image','image/jpeg')})
        self.assertEqual(response.status_code,400)
        self.assertEqual(store.get_item('recipes',recipe['id']).get('image'),recipe.get('image'))

    def test_case_collisions_do_not_overwrite(self):
        path=Path(store.data_path('recipes','case-test.json'))
        path.write_text('{"id":"Case-Test","title":"Keep"}')
        try:
            result=self.client.post('/api/recipes',json={'id':'case-test','title':'Overwrite'})
            self.assertEqual(result.status_code,400)
            self.assertEqual(json.loads(path.read_text())['title'],'Keep')
        finally:path.unlink()

    def test_symlink_record_not_followed(self):
        target=Path(TEMP.name)/'external.json';target.write_text('{"id":"external"}')
        link=Path(store.data_path('recipes','link.json'));link.symlink_to(target)
        try:
            with self.assertRaises(ValueError):store.get_item('recipes','link')
            self.assertNotIn('external',[x['id'] for x in store.list_items('recipes')])
        finally:link.unlink()


if __name__=='__main__':
    try:unittest.main()
    finally:TEMP.cleanup()
