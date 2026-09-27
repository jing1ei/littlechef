"""Photo entry contract tests with mocked providers; no external AI calls."""
import base64
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
TEMP = tempfile.TemporaryDirectory(prefix='kitchen-photo-test-')
os.environ.update(LITTLE_CHEF_DATA_DIR=TEMP.name, LITTLE_CHEF_EDIT_PIN='', LITTLE_CHEF_READ_ONLY='0')
from PIL import Image
from fastapi.testclient import TestClient
from app import photoai, settings, store
from app.main import app


def photo(color):
    out = io.BytesIO()
    Image.new('RGB', (40, 30), color).save(out, 'JPEG')
    return out.getvalue()


class PhotoTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        settings.update({'vision_model': 'test-vision', 'vision_api_key': 'test-key',
                         'photo_edit_api_key': 'test-edit-key', 'photo_edit_model': 'test-image'})

    def test_analysis_sends_photo_and_normalizes(self):
        answer = {'draft': {'id': '../bad', 'title': '番茄炒蛋', 'image': 'bad.jpg',
                            'ingredients': [{'name': '鸡蛋', 'qty': None}],
                            'tags': {'diet': ['无麸质'], 'main': ['蛋']}, 'steps': 'invalid'},
                  'uncertainties': ['用量无法确认']}
        with patch('app.imagegen._post_json', return_value={'choices': [{'message': {'content': json.dumps(answer)}}]}) as request:
            response = self.client.post('/api/photos/analyze', files={'file': ('test.jpg', photo('red'), 'image/jpeg')}, data={'kind': 'recipe'})
        self.assertEqual(response.status_code, 200)
        draft = response.json()['draft']
        self.assertNotIn('id', draft)
        self.assertNotIn('image', draft)
        self.assertNotIn('diet', draft['tags'])
        self.assertEqual(draft['ingredients'][0]['qty'], '')
        self.assertEqual(draft['steps'], [])
        sent = request.call_args.args[1]['messages'][0]['content']
        self.assertTrue(sent[1]['image_url']['url'].startswith('data:image/jpeg;base64,'))

    def test_reference_image_is_sent_to_edit_endpoint(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return json.dumps({'data': [{'b64_json': base64.b64encode(photo('green')).decode()}]}).encode()
        with patch('urllib.request.urlopen', return_value=Response()) as request:
            result = photoai.stylize(photo('red'))
        req = request.call_args.args[0]
        self.assertTrue(req.full_url.endswith('/images/edits'))
        self.assertIn(b'name="image"; filename="photo.jpg"', req.data)
        self.assertIn(photo('red'), req.data)
        self.assertTrue(result.startswith('data:image/jpeg;base64,'))

    def test_saved_variants_can_switch_and_survive_export(self):
        for collection in ['recipes', 'pantry']:
            payload = {'id': 'photo-' + collection, 'title': '菜', 'name': '食材',
                       'photo_assets': {'original': photoai.data_url(photo('red')),
                                        'illustration': photoai.data_url(photo('green')), 'selected': 'illustration'}}
            result = self.client.post('/api/' + collection, json=payload)
            self.assertEqual(result.status_code, 200, result.text)
            saved = result.json()
            self.assertNotIn('photo_assets', saved)
            self.assertEqual(saved['image'], saved['illustration_image'])
            self.assertNotEqual(saved['original_image'], saved['illustration_image'])
            saved['image'] = saved['original_image']
            switched = self.client.post('/api/' + collection, json=saved).json()
            self.assertEqual(switched['image'], saved['original_image'])
            exported = self.client.get('/api/export').json()
            for field in ['original_image', 'illustration_image']:
                self.assertIn(saved[field], exported['images'])
                self.assertEqual(self.client.get('/img/' + saved[field]).status_code, 200)
            self.client.delete('/api/' + collection + '/' + saved['id'])
            for field in ['original_image', 'illustration_image']:
                self.assertFalse(Path(store.data_path('images', saved[field])).exists())

    def test_invalid_photos_and_provider_failures(self):
        for kind in ['unknown', 'recipe']:
            response = self.client.post('/api/photos/analyze', files={'file': ('bad.jpg', b'not an image')}, data={'kind': kind})
            self.assertEqual(response.status_code, 400)
        with patch('app.photoai.analyze', side_effect=TimeoutError('secret test-key')):
            response = self.client.post('/api/photos/analyze', files={'file': ('test.jpg', photo('red'))})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('test-key', response.text)
        response = self.client.post('/api/recipes', json={'id': 'invalid-photo', 'photo_assets': {'original': 'invalid'}})
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(store.get_item('recipes', 'invalid-photo'))

    def test_pin_and_readonly(self):
        settings.update({'edit_pin': '1234'})
        try:
            response = self.client.post('/api/photos/analyze', files={'file': ('test.jpg', photo('red'))})
            self.assertEqual(response.status_code, 401)
            settings.update({'read_only': True})
            response = self.client.post('/api/photos/analyze', files={'file': ('test.jpg', photo('red'))}, headers={'X-Kitchen-Pin': '1234'})
            self.assertEqual(response.status_code, 403)
        finally:
            settings.update({'edit_pin': '', 'read_only': False})


if __name__ == '__main__':
    try: unittest.main()
    finally: TEMP.cleanup()
