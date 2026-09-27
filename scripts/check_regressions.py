"""Isolated regression checks: python scripts/check_regressions.py."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TEMP = tempfile.TemporaryDirectory(prefix='kitchen-regression-')
os.environ['LITTLE_CHEF_DATA_DIR'] = str(Path(TEMP.name) / 'notebook')
os.environ['LITTLE_CHEF_IMAGE_PROVIDER'] = 'none'
os.environ['LITTLE_CHEF_EDIT_PIN'] = ''
os.environ['LITTLE_CHEF_READ_ONLY'] = '0'
from fastapi.testclient import TestClient
from app.main import app
from app import store


class NotebookChecks(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_id_roundtrip_and_validation(self):
        item = {'id': 'My_recipe.1', 'title': '菜谱'}
        response = self.client.post('/api/recipes', json=item)
        self.assertEqual(response.json()['id'], item['id'])
        for payload in [{'id': '../bad'}, {'id': 3}, {'id': 'bad', 'tags': []},
                        {'id': 'bad', 'steps': ['wrong']}]:
            self.assertEqual(self.client.post('/api/recipes', json=payload).status_code, 400)
        self.assertIsNone(store.get_item('recipes', 'bad'))

    def test_images_roundtrip_and_recovery(self):
        raw = b'test photo bytes'
        store.save_item('recipes', {'id': 'photo-test', 'image': 'photo-test.png'})
        image = Path(store.data_path('images', 'photo-test.png'))
        image.write_bytes(raw)
        exported = self.client.get('/api/export').json()
        self.assertEqual(base64.b64decode(exported['images']['photo-test.png'].split(',')[1]), raw)
        image.write_bytes(b'newer photo')
        result = self.client.post('/api/import', json=exported)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(image.read_bytes(), raw)
        recovery = Path(store.DATA_DIR) / result.json()['snapshot'] / 'images' / image.name
        self.assertEqual(recovery.read_bytes(), b'newer photo')
        bad = {'recipes': [{'id': 'must-not-write'}], 'images': {'../bad': 'data:x;base64,eA=='}}
        self.assertEqual(self.client.post('/api/import', json=bad).status_code, 400)
        self.assertIsNone(store.get_item('recipes', 'must-not-write'))

    def test_shared_image_survives_delete(self):
        image = Path(store.data_path('images', 'shared.png'))
        image.write_bytes(b'shared')
        for item_id in ['shared-a', 'shared-b']:
            store.save_item('recipes', {'id': item_id, 'image': image.name})
        store.delete_item('recipes', 'shared-a')
        self.assertTrue(image.exists())
        store.delete_item('recipes', 'shared-b')
        self.assertFalse(image.exists())

    def test_atomic_writes(self):
        path = store.data_path('atomic.json')
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda n: store.write_json(path, {'n': n}), range(40)))
        self.assertIn(json.loads(Path(path).read_text())['n'], range(40))
        self.assertEqual(Path(path).stat().st_mode & 0o777, 0o600)

    def test_empty_notebook_does_not_reseed(self):
        env = dict(os.environ, LITTLE_CHEF_DATA_DIR=str(Path(TEMP.name) / 'reseed'))
        code = "from app import store; store.seed_if_empty(); [store.delete_item('recipes', r['id']) for r in store.list_items('recipes')]; assert not store.seed_if_empty(); assert not store.list_items('recipes')"
        subprocess.run([sys.executable, '-c', code], cwd=ROOT, env=env, check=True)

    def test_dry_run_and_export_destination(self):
        data = Path(TEMP.name) / 'dry-data'
        bundle = Path(TEMP.name) / 'bundle.json'
        bundle.write_text(json.dumps({'kitchen_notes': 1, 'only_local_changes': {'recipes': [{'id': 'dry', 'title': 'Dry'}]}}))
        env = dict(os.environ, LITTLE_CHEF_DATA_DIR=str(data))
        subprocess.run([sys.executable, str(ROOT / 'scripts/merge_export.py'), str(bundle), '--dry-run'], env=env, check=True)
        self.assertFalse(data.exists())
        out = Path(TEMP.name) / 'important'
        out.mkdir()
        keep = out / 'keep.txt'
        keep.write_text('keep me')
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/export_static.py'), '--out', str(out)], env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(keep.read_text(), 'keep me')
        self.assertFalse(data.exists())

    def test_parallel_logs(self):
        self.client.post('/api/recipes', json={'id': 'parallel', 'title': 'parallel'})
        def log(n):
            response = self.client.post('/api/recipes/parallel/log', json={'note': str(n)})
            self.assertEqual(response.status_code, 200)
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(log, range(20)))
        self.assertEqual(len(store.get_item('recipes', 'parallel')['log']), 20)


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        TEMP.cleanup()
