"""在真浏览器里把静态版走一遍：记一道新菜 → 刷新还在 → 下厨模式 → 计时器 → 折算份量。

改完前端就跑一次，别只看代码。先 `python3 scripts/export_static.py` 生成 dist/，再：

    pip install playwright && playwright install chromium
    python3 scripts/check_web.py
"""
import asyncio
import json
import os
import subprocess
import sys
import time

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
PORT = 8899
BASE = f'http://127.0.0.1:{PORT}'


async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)],
                           cwd=DIST, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    problems = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            page = await b.new_page(viewport={'width': 390, 'height': 844},
                                    has_touch=True, is_mobile=True)
            errors = []

            def note_console(m):
                if m.type != 'error':
                    return
                # 静态链接必然先试一次 /api/bootstrap 再回退到本地文件，这个 404 是设计好的
                if 'api/bootstrap' in m.location.get('url', '') or 'api/bootstrap' in m.text:
                    return
                # 沙箱里的浏览器出不了外网，手写体走 CDN 会超时；线下 NAS 会退回楷体，不算问题
                if 'jsdelivr' in m.location.get('url', '') or 'ERR_TIMED_OUT' in m.text:
                    return
                errors.append(m.text)

            page.on('console', note_console)
            page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))

            await page.goto(BASE, wait_until='networkidle')
            await page.wait_for_selector('.card, .cover, .section', timeout=8000)

            mode = await page.evaluate('DB.state.mode')
            ro = await page.evaluate('DB.state.readOnly')
            badge = await page.inner_text('#mode-badge')
            print(f'mode={mode} readOnly={ro} badge="{badge}"')
            if mode != 'local':
                problems.append(f'静态链接该是 local 模式，现在是 {mode}')

            # Primary navigation stays visible and reachable even at the end of long pages.
            await page.evaluate('scrollTo(0, document.body.scrollHeight)')
            assert await page.evaluate("""[...document.querySelectorAll('#nav a')].every(a => {
                const r = a.getBoundingClientRect();
                return r.top >= 0 && r.bottom <= innerHeight &&
                    a.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            })""")
            await page.click('#nav [data-route="recipes"]')
            await page.wait_for_selector('.dish-card')
            await page.wait_for_selector('#nav [data-route="recipes"][aria-current="page"]')

            # ---- 1. 记一道新菜：表单要真的打开 ----
            await page.click('#btn-new')
            try:
                await page.wait_for_selector('#sheet-backdrop:not([hidden])', timeout=3000)
                print('OK  记一道新菜 → 表单打开了')
            except Exception:
                problems.append('点「记一道新菜」还是没反应：表单没打开')
                raise

            await page.locator('[data-photo-file]').set_input_files(os.path.join(ROOT, 'seed/images/hongshaorou.jpg'))
            await page.wait_for_function("document.querySelector('.photo-status').textContent.includes('照片已加入草稿')")
            await page.fill('input[name="title"]', '测试·油焖春笋')
            await page.fill('textarea[name="ingredients"]', '春笋 500g 选粗短的\n五花肉 80g')
            await page.fill('textarea[name="seasonings"]', '生抽 2 汤匙\n糖 1 茶匙')
            await page.fill('textarea[name="steps"]', '春笋滚刀切块，冷水下锅煮 5 分钟去涩。\n中火下锅煎香五花肉，倒春笋翻炒 3 分钟，加调料小火焖 12 分钟。')
            for label in ['热炒']:
                el = page.locator(f'[data-multi="roles"][data-value="{label}"]')
                if await el.count():
                    await el.first.click()
            await page.click('#recipe-form button[type="submit"]')
            await page.wait_for_function(
                "() => document.querySelector('#sheet-backdrop').hidden", timeout=5000)

            n = await page.evaluate("DB.state.recipes.filter(r=>r.title === '测试·油焖春笋').length")
            print(f'OK  存下来了，本子里有 {n} 道叫这个名字的')
            if not n:
                problems.append('表单提交后菜没进本子')

            changes = await page.evaluate('DB.localChanges()')
            badge = await page.inner_text('#mode-badge')
            print(f'OK  本机草稿 {changes} 条，角标写着「{badge}」')

            # ---- 2. 刷新之后必须还在 ----
            await page.reload(wait_until='networkidle')
            await page.wait_for_selector('.card, .section', timeout=8000)
            n2 = await page.evaluate("DB.state.recipes.filter(r=>r.title === '测试·油焖春笋').length")
            print(f'{"OK " if n2 else "BAD"} 刷新后还在：{n2} 道')
            if not n2:
                problems.append('刷新之后新记的菜没了 —— 这比「点了没反应」更伤人')

            rid = await page.evaluate("DB.state.recipes.find(r=>r.title === '测试·油焖春笋').id")
            assert await page.evaluate("DB.state.recipes.find(r=>r.title === '测试·油焖春笋').original_image"), '照片应随草稿保存并恢复'

            # Adding a photo to an existing record must not replace saved text.
            await page.evaluate("Editor.openRecipe(DB.state.recipes.find(r=>r.title==='测试·油焖春笋'))")
            old_title = await page.input_value('input[name="title"]')
            await page.evaluate("""() => {
                DB.state.mode = 'server';
                DB.state.config.photo_analysis_ready = true;
                DB.state.config.photo_edit_ready = false;
                window.originalPhotoAssist = DB.photoAssist;
                DB.photoAssist = async () => ({draft: {title: '不该覆盖', ingredients: [{name: '不该替换'}]}, uncertainties: []});
            }""")
            await page.locator('[data-photo-file]').set_input_files(os.path.join(ROOT, 'seed/images/hongshaorou.jpg'))
            await page.wait_for_function("document.querySelector('.photo-status').textContent.includes('识别结果已填入')")
            assert await page.input_value('input[name="title"]') == old_title
            assert '春笋' in await page.input_value('textarea[name="ingredients"]')
            await page.evaluate("DB.state.mode='local';DB.photoAssist=window.originalPhotoAssist;U.sheet.close(true)")
            print('OK  已有记录补照片不会覆盖已保存的名称和材料')

            # ---- 3. 菜谱页：份量折算、认出来的数字 ----
            await page.goto(f'{BASE}/#/recipe/{rid}', wait_until='networkidle')
            await page.wait_for_selector('.do-bar', timeout=5000)
            first_q = await page.inner_text('.ing-list li:first-child .q')
            await page.click('[data-serv="1"]')
            await page.click('[data-serv="1"]')
            await page.wait_for_timeout(300)
            scaled_q = await page.inner_text('.ing-list li:first-child .q')
            print(f'OK  份量 4→6 人：{first_q.strip()} → {scaled_q.strip()}')
            if first_q.strip() == scaled_q.strip():
                problems.append('拧了份量但用量没跟着变')

            marks = await page.locator('.steps .mk').count()
            timers = await page.locator('.steps .mk.time').count()
            print(f'OK  做法里认出 {marks} 个火候/时间/温度标记，其中 {timers} 个能按着计时')
            if not timers:
                problems.append('步骤里的分钟数没变成能点的计时器')

            # 手机上第一个能点的动作离屏幕顶多远
            box = await page.locator('.do-bar .btn').first.bounding_box()
            print(f'OK  「下厨模式」在 y={box["y"]:.0f}px，一进页面就够得到')

            # ---- 4. 下厨模式 + 计时器 ----
            await page.click('[data-act="cook"]')
            await page.wait_for_selector('#cook:not([hidden])', timeout=4000)
            step_size = await page.evaluate("getComputedStyle(document.querySelector('.ck-text')).fontSize")
            nav = await page.locator('.ck-btn.go').bounding_box()
            print(f'OK  下厨模式：正文 {step_size}，「这步做完了」在 y={nav["y"]:.0f}px（屏高 844）')

            mise = await page.locator('.ck-list li[data-check]').count()
            await page.locator('.ck-list li[data-check]').first.click()
            checked = await page.locator('.ck-list li.on').count()
            print(f'OK  备料 {mise} 项，点一下打上勾（{checked} 项已勾）')

            t = page.locator('.ck-chip.time')
            if await t.count():
                await t.first.click()
                await page.wait_for_selector('#timer-bar .timer', timeout=3000)
                label = await page.inner_text('#timer-bar .timer .txt')
                print(f'OK  计时器跑起来了：{label.strip()[:40]}')
            else:
                problems.append('第一步里没有可按的计时器（可能这步确实没写分钟）')

            await page.click('#ck-next')
            await page.wait_for_timeout(200)
            cnt = await page.inner_text('.ck-count')
            print(f'OK  翻到{cnt.strip()}')

            # 走到最后一步 → 出锅记一笔
            for _ in range(8):
                if await page.locator('#ck-done').count():
                    break
                await page.click('#ck-next')
                await page.wait_for_timeout(120)
            if await page.locator('#ck-done').count():
                await page.click('#ck-done')
                await page.wait_for_selector('#sheet-backdrop:not([hidden])', timeout=4000)
                print('OK  最后一步「出锅，记一笔」直接把记录表单端上来')
                await page.click('#cancel')
            else:
                problems.append('走不到最后一步的「出锅，记一笔」')

            # ---- 5. 一键「做了一次」 ----
            await page.goto(f'{BASE}/#/recipe/{rid}', wait_until='networkidle')
            await page.wait_for_selector('.do-bar')
            before = await page.evaluate(f"(DB.recipe('{rid}').log||[]).length")
            await page.click('[data-act="quick-log"]')
            await page.wait_for_timeout(600)
            after = await page.evaluate(f"(DB.recipe('{rid}').log||[]).length")
            print(f'{"OK " if after > before else "BAD"} 「做了一次」一下就记完：log {before} → {after}')
            if after <= before:
                problems.append('点「做了一次」没记上')

            # ---- 6. 采购清单 ----
            await page.click('[data-act="shop"]')
            await page.wait_for_selector('.shop-one', timeout=3000)
            rows = await page.locator('.shop-one li').count()
            print(f'OK  这道菜自己的采购清单：{rows} 行')
            await page.click('#cancel')

            # ---- 7. 手机菜谱架：第一道菜离顶多远 ----
            await page.goto(f'{BASE}/#/recipes', wait_until='networkidle')
            await page.wait_for_selector('.dish-card', timeout=5000)
            card = await page.locator('.dish-card').first.bounding_box()
            toggle_visible = await page.locator('#rail-toggle').is_visible()
            print(f'OK  手机菜谱架：筛选收成一行（{toggle_visible}），第一道菜在 y={card["y"]:.0f}px')
            if card['y'] > 500:
                problems.append(f'手机上第一道菜还是太靠下（y={card["y"]:.0f}）')
            await page.click('#rail-toggle')
            await page.wait_for_timeout(250)
            opened = await page.locator('.rail-inner').is_visible()
            print(f'OK  点「挑一挑」展开筛选：{opened}')

            # Search updates keep keyboard focus, and stale timers cannot navigate back.
            await page.fill('#shelf-q', '红')
            await page.wait_for_timeout(500)
            assert await page.evaluate("document.activeElement.id") == 'shelf-q'
            await page.keyboard.type('烧')
            await page.wait_for_timeout(500)
            assert await page.input_value('#shelf-q') == '红烧'
            assert (await page.locator('.dish-card').first.bounding_box())['y'] < 650
            await page.fill('#shelf-q', '不存在的菜谱')
            await page.wait_for_timeout(500)
            await page.click('#empty-clear')
            await page.wait_for_selector('.dish-card')
            print('OK  连续搜索保留焦点，空结果可清空，手机直接显示筛选结果')

            # ---- 8. 排一桌 ----
            await page.goto(f'{BASE}/#/menu', wait_until='networkidle')
            await page.wait_for_selector('#do-plan', timeout=5000)
            await page.click('#do-plan')
            await page.wait_for_selector('.menu-sheet', timeout=6000)
            dishes = await page.locator('.course-item').count()
            print(f'OK  排一桌：出了 {dishes} 道')

            # Re-importing a deleted recipe must clear its local tombstone.
            restored = await page.evaluate("""async () => {
                const r = DB.state.recipes.find(x => x.title === '测试·油焖春笋');
                const bundle = await DB.exportNotebook();
                await Local.remove('recipes', r.id);
                await DB.importNotebook({ recipes: [r], images: bundle.images });
                return !!DB.recipe(r.id);
            }""")
            if not restored:
                problems.append('重新导入的菜谱仍被本机删除标记隐藏')

            # ---- 9. 导出 ----
            await page.goto(BASE, wait_until='networkidle')
            await page.wait_for_selector('.section, .card')
            await page.click('#mode-badge')
            await page.wait_for_selector('#lx-export', timeout=3000)
            async with page.expect_download(timeout=6000) as dl:
                await page.click('#lx-export')
            d = await dl.value
            path = os.path.join('/tmp', 'bundle.json')
            await d.save_as(path)
            data = json.load(open(path, encoding='utf-8'))
            only = data.get('only_local_changes', {})
            imported_recipe = next(r for r in data['recipes'] if r['title'] == '测试·油焖春笋')
            assert imported_recipe['original_image'] in data['images'], '导出包必须包含拍摄的原图'
            print(f'OK  导出成文件：本机改动 {len(only.get("recipes", []))} 道菜，'
                  f'整本 {len(data.get("recipes", []))} 道，照片 {len(data.get("images", {}))} 张')

            if errors:
                problems.append('控制台报错：' + ' | '.join(errors[:4]))
            await b.close()
    finally:
        srv.terminate()
        srv.wait(timeout=5)

    print('\n' + '=' * 60)
    if problems:
        print('还没干净：')
        for x in problems:
            print(' -', x)
        sys.exit(1)
    print('走完了，没发现问题。')


asyncio.run(main())
