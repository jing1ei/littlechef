/* app.js — 路由和开门 */

const App = (() => {
  let current = { path: '#/', params: {} };

  function parseHash() {
    const raw = location.hash || '#/';
    const split = raw.indexOf('?');
    const pathPart = split < 0 ? raw : raw.slice(0, split);
    const params = Object.fromEntries(new URLSearchParams(split < 0 ? '' : raw.slice(split + 1)));
    return { path: pathPart || '#/', params };
  }

  function go(path, params) {
    const q = Object.keys(params || {})
      .filter((k) => params[k] !== '' && params[k] != null)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    location.hash = q ? `${path}?${q}` : path;
  }

  function markNav(route) {
    U.qsa('#nav a').forEach((a) => {
      const active = a.dataset.route === route;
      a.classList.toggle('on', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function render() {
    const { path, params } = current;
    const view = U.qs('#view');
    const focused = document.activeElement;
    const searchState = ['shelf-q', 'pantry-q'].includes(focused.id)
      ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd } : null;
    const seg = path.replace(/^#\/?/, '').split('/');
    const head = seg[0] || '';

    try {
      if (head === '' || head === 'home') {
        markNav('home');
        view.innerHTML = Views.home();
        Views.homeBind(view);
      } else if (head === 'recipes') {
        markNav('recipes');
        view.innerHTML = Views.recipes(params);
        Views.recipesBind(view, params);
      } else if (head === 'recipe') {
        markNav('recipes');
        view.innerHTML = Views.recipe(seg[1]);
        Views.recipeBind(view, seg[1]);
      } else if (head === 'pantry') {
        markNav('pantry');
        if (seg[1]) {
          view.innerHTML = Views.pantryItem(seg[1]);
          Views.pantryItemBind(view, seg[1]);
        } else {
          view.innerHTML = Views.pantry(params);
          Views.pantryBind(view, params);
        }
      } else if (head === 'menu') {
        markNav('menu');
        if (seg[1]) {
          view.innerHTML = MenuView.savedDetail(seg[1]);
          MenuView.savedDetailBind(view);
        } else {
          view.innerHTML = MenuView.view();
          MenuView.bind(view);
        }
      } else if (head === 'menus') {
        markNav('menu');
        view.innerHTML = MenuView.saved();
      } else if (head === 'tags') {
        markNav('tags');
        view.innerHTML = Views.tags();
      } else {
        view.innerHTML = '<div class="empty">这一页不存在。<a href="#/">回家</a></div>';
      }
    } catch (err) {
      console.error(err);
      view.innerHTML = `<div class="empty">这一页出了点问题：${U.esc(err.message)}</div>`;
    }
    if (searchState) {
      const input = document.getElementById(searchState.id);
      if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(searchState.start, searchState.end); }
    }
    refreshBadge();
  }

  function onHash() {
    const next = parseHash();
    const changedPage = next.path !== current.path;
    if (changedPage && document.body.classList.contains('cooking')) Cook.close();
    current = next;
    render();
    if (changedPage) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // ------------------------------------------------- 本机草稿这件事 --- //

  /** 不连 NAS 的时候，改动落在这台设备的浏览器里。角标要说清楚存了多少条，
   *  以免有人以为白写了。 */
  function refreshBadge() {
    const badge = U.qs('#mode-badge');
    if (!badge) return;
    if (DB.state.mode !== 'local' || DB.state.readOnly) {
      badge.classList.remove('badge-local');
      badge.hidden = !DB.state.readOnly && !!DB.state.config.image_ready;
      badge.textContent = DB.state.readOnly ? '只读模式' : '配置插画';
      badge.title = DB.state.readOnly ? '打开设置，可关闭只读模式' : '打开设置，选择插画服务';
      return;
    }
    const n = DB.localChanges();
    badge.hidden = false;
    badge.classList.add('badge-local');
    badge.textContent = n ? `本机草稿 · ${n} 条` : '本机草稿';
    badge.title = '这个链接上的改动只存在这台设备里。点一下可以导出成文件，搬到家里的 NAS。';
  }

  function openLocalSheet() {
    const n = DB.localChanges();
    if (!U.sheet.open(`
      <h2>本机草稿</h2>
      <div class="sub">这个网页版没连家里的 NAS，你写的东西存在这台设备的浏览器里。</div>
      <p class="prose">
        ${n ? `现在有 <b>${n}</b> 条本机改动。` : '现在还没有本机改动。'}
        随手记完全没问题，换设备或者清了浏览器数据就会没，所以要留就导出一份，
        回家后用随项目提供的草稿合并工具并入 NAS。
      </p>
      <div class="btn-row">
        <button class="btn btn-ink" id="lx-export">导出成文件</button>
        <button class="btn btn-quiet" id="lx-import">从文件导入</button>
        ${n ? '<button class="btn btn-quiet danger" id="lx-reset">清掉本机改动</button>' : ''}
      </div>
      <input type="file" id="lx-file" accept="application/json" hidden>`)) return;

    const root = U.qs('#sheet-body');
    U.qs('#lx-export', root).addEventListener('click', () => U.action(U.qs('#lx-export', root), async () => {
      const bundle = await DB.exportNotebook();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `littlechef-${U.today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      U.toast('导出好了，存进网盘或者直接发给自己');
    }, '正在导出…'));
    U.qs('#lx-import', root).addEventListener('click', () => U.qs('#lx-file', root).click());
    U.qs('#lx-file', root).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const counts = await DB.importNotebook(JSON.parse(await file.text()));
        U.sheet.close();
        refreshBadge();
        render();
        U.toast(`导入了 ${counts.recipes || 0} 道菜`);
      } catch (err) { U.toast('这个文件读不了：' + err.message); }
    });
    const reset = U.qs('#lx-reset', root);
    if (reset) reset.addEventListener('click', async () => {
      if (!confirm('本机的改动会全部没掉，确定？')) return;
      await U.action(reset, async () => {
        await DB.resetLocal();
        U.sheet.close();
        refreshBadge();
        render();
        U.toast('清干净了，回到原来那本');
      }, '正在清理…');
    });
  }

  // 站在灶台边的人不该被一句「打不开」挡住。所有按钮和快捷键的绑定都在
  // 数据加载之前完成，boot 里做的只有「把数据搬进来 + 按状态刷新界面」。
  function wireChrome() {
    const nav = U.qs('#nav');
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--bottom-nav-height', nav.getBoundingClientRect().height + 'px');
    }).observe(nav);
    nav.addEventListener('click', (event) => {
      const link = event.target.closest('a');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (!U.sheet.close()) return;
      if (document.body.classList.contains('cooking')) Cook.close();
      const target = link.getAttribute('href');
      if (location.hash === target) {
        window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      } else location.hash = target;
    });

    U.qs('#btn-new').addEventListener('click', () => {
      if (!DB.state.ready) {
        // 还没开门就点了「记一道」：重试一次开门；开不了就给一个明白的出口。
        boot(true).then(() => {
          if (DB.state.ready && !DB.state.readOnly) Editor.openRecipe(null);
        });
        return;
      }
      if (DB.state.readOnly) {
        U.toast('这本菜谱被设成只读了（LITTLE_CHEF_READ_ONLY=1）');
        return;
      }
      Editor.openRecipe(null);
    });

    U.qs('#mode-badge').addEventListener('click', () => {
      if (DB.state.mode === 'local') openLocalSheet();
      else Settings.open();
    });

    const settingsBtn = U.qs('#btn-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', () => Settings.open());

    U.qs('#sheet-close').addEventListener('click', () => U.sheet.close());
    U.qs('#sheet-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'sheet-backdrop') U.sheet.close();
    });
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') U.sheet.close();
      if (e.key === 'Tab' && !U.qs('#sheet-backdrop').hidden) {
        const focusable = [...U.qsa('button, input, textarea, select, a[href], [tabindex="0"]', U.qs('#sheet')), ...U.qsa('#nav a')]
          .filter((el) => !el.disabled && el.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    window.addEventListener('hashchange', onHash);
  }

  let chromeWired = false;
  let hashListening = false;

  async function boot(isRetry) {
    if (!chromeWired) { wireChrome(); chromeWired = true; }

    try {
      await DB.boot();
    } catch (err) {
      const msg = U.esc(err.message);
      U.qs('#view').innerHTML =
        `<div class="empty">打不开菜谱：${msg}<br><br>` +
        `<button class="btn btn-ink" id="btn-retry-boot">再试一次</button></div>`;
      const retry = U.qs('#btn-retry-boot');
      if (retry) retry.addEventListener('click', () => boot(true));
      return;
    }

    const cfg = DB.state.config || {};
    if (cfg.house_name) U.qs('[data-house-name]').textContent = cfg.house_name;
    if (cfg.house_subtitle) U.qs('[data-house-sub]').textContent = cfg.house_subtitle;
    document.title = `${cfg.house_name || 'littlechef'} · ${cfg.house_subtitle || '家庭菜谱'}`;

    const badge = U.qs('#mode-badge');
    if (DB.state.readOnly) {
      badge.hidden = false;
      badge.textContent = '只读模式';
      badge.title = '这本菜谱现在是只读的。点开设置里可以关掉。';
    } else if (DB.state.mode === 'server' && !cfg.image_ready) {
      badge.hidden = false;
      badge.textContent = '配置插画';
      badge.title = '还没配出图模型。点一下打开设置去配 API Key。';
    }

    // 静态分享站点里，配置写不到 NAS 上；把齿轮藏起来免得误触
    const settingsBtn = U.qs('#btn-settings');
    if (settingsBtn) settingsBtn.hidden = DB.state.mode !== 'server';

    refreshBadge();

    if (!hashListening) { onHash(); hashListening = true; }
    else render();
  }

  return { boot, render, go, refreshBadge, get params() { return current.params; } };
})();

document.addEventListener('DOMContentLoaded', App.boot);
