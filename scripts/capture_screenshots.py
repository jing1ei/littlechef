"""Capture README screenshots from a fresh temporary notebook (requires Playwright)."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'screenshots'


def capture():
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='kitchen-screenshots-') as data:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        env = {k: v for k, v in os.environ.items() if not k.startswith(('LITTLE_CHEF_', 'KITCHEN_', 'OPENAI_', 'ARK_', 'SD_'))}
        env.update(LITTLE_CHEF_DATA_DIR=data, LITTLE_CHEF_IMAGE_PROVIDER='none', PYTHONDONTWRITEBYTECODE='1')
        server = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(port)],
                                  cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f'http://127.0.0.1:{port}/app/'
        try:
            for _ in range(300):
                try:
                    urllib.request.urlopen(base, timeout=1).close()
                    break
                except OSError:
                    if server.poll() is not None: raise RuntimeError('Screenshot server failed to start')
                    time.sleep(.2)
            else: raise RuntimeError('Screenshot server did not become ready')
            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(viewport={'width': 1280, 'height': 900}, device_scale_factor=1, reduced_motion='reduce')
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                def shot(name):
                    page.evaluate('document.fonts.ready')
                    page.wait_for_function("[...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight).every(i=>i.complete)")
                    page.screenshot(path=str(OUT / name), type='jpeg', quality=86)
                page.goto(base + '#/recipes', wait_until='networkidle')
                page.wait_for_selector('.dish-card')
                shot('recipe-shelf.jpg')
                page.goto(base + '#/pantry', wait_until='networkidle')
                page.wait_for_selector('.pantry-card')
                shot('pantry.jpg')
                page.goto(base + '#/menu', wait_until='networkidle')
                page.locator('#do-plan').click()
                page.wait_for_selector('.menu-sheet')
                page.evaluate('scrollTo(0, 0)')
                shot('menu-planner.jpg')
                page.set_viewport_size({'width': 390, 'height': 844})
                page.goto(base + '#/recipe/hongshaorou', wait_until='networkidle')
                page.locator('[data-act=cook]').click()
                page.locator('.ck-mise summary').click()
                page.locator('.ck-chip.time').first.click()
                page.evaluate("document.querySelector('#toast').hidden=true")
                shot('cooking-mode.jpg')
                page.goto(base + '#/recipes', wait_until='networkidle')
                page.reload(wait_until='networkidle')
                page.wait_for_selector('.dish-card')
                page.locator('#btn-new').click()
                page.locator('[data-photo-file]').set_input_files(str(ROOT / 'seed/images/hongshaorou.jpg'))
                page.wait_for_function("document.querySelector('.photo-status').textContent.includes('尚未配置')")
                shot('photo-entry.jpg')
                assert not errors, errors
                browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)
    print('Captured 5 real UI screenshots in', OUT)


if __name__ == '__main__':
    capture()
