/* data.js — 和数据说话。
 *
 * 两种模式，都能写：
 *   server  家里的 NAS 开着，改动直接落到 data/ 里的 JSON 文件
 *   local   只有一份静态菜谱（比如分享出去的链接），改动记在这台设备的浏览器里，
 *           随时能导出带回家。**不再是只读**。
 */

const DB = (() => {
  const state = {
    ready: false,
    mode: 'server',        // server | local
    readOnly: false,       // 只有服务端明说 LITTLE_CHEF_READ_ONLY 才是真只读
    pin: (() => { try { return localStorage.getItem('kitchen-pin') || ''; } catch (_) { return ''; } })(),
    imgBase: '/img/',
    config: {},
    base: null,            // local 模式下的静态底本
    taxonomy: null,
    recipes: [],
    pantry: [],
    menus: [],
  };

  const byId = (list, id) => list.find((x) => x.id === id);

  async function req(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (state.pin) headers['X-Kitchen-Pin'] = state.pin;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (res.status === 401 && !opts._retriedPin) {
      // NAS 设了 LITTLE_CHEF_EDIT_PIN，前端还没拿到。让人当场输一次，成了就重试原请求。
      const pin = await promptPin(!!state.pin);
      if (pin) {
        setPin(pin);
        return req(path, Object.assign({}, opts, { _retriedPin: true }));
      }
      throw new Error('要先解锁写入（家里的 PIN）才能保存');
    }
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail || detail; } catch (e) { /* 无所谓 */ }
      throw new Error(detail);
    }
    return res.status === 204 ? null : res.json();
  }

  /** 等用户输 PIN。同一时间只弹一次；多个请求同时撞 401 会共用同一个 Promise。 */
  let pendingPin = null;
  function promptPin(wasWrong) {
    if (pendingPin) return pendingPin;
    pendingPin = new Promise((resolve) => {
      const dialog = U.el(`<dialog class="pin-dialog" aria-labelledby="pin-title">
        <form method="dialog"><h2 id="pin-title">解锁写入</h2>
        <p>${wasWrong ? '刚才的 PIN 不对，请重试。' : '请输入家里的编辑 PIN。'}</p>
        <input type="password" id="pin-input" autocomplete="off" aria-label="编辑 PIN" autofocus>
        <div class="btn-row"><button class="btn btn-ink" value="ok">解锁</button>
        <button class="btn btn-quiet" value="cancel">先不了</button></div></form></dialog>`);
      document.body.appendChild(dialog);
      dialog.addEventListener('close', () => {
        const value = dialog.returnValue === 'ok' ? dialog.querySelector('input').value.trim() : '';
        dialog.remove();
        pendingPin = null;
        resolve(value);
      }, { once: true });
      dialog.showModal();
    });
    return pendingPin;
  }

  function absorb(payload) {
    state.taxonomy = payload.taxonomy;
    state.recipes = payload.recipes || [];
    state.pantry = payload.pantry || [];
    state.menus = payload.menus || [];
    state.config = payload.config || state.config || {};
    state.readOnly = !!state.config.read_only;
    state.ready = true;
  }

  /** local 模式：静态底本 + 这台设备上的改动 */
  function rebuild() {
    absorb(Object.assign({}, Local.apply(state.base), { config: state.config }));
  }

  async function boot() {
    try {
      const payload = await req('/api/bootstrap');
      if (!payload || !payload.taxonomy) throw new Error('不像是菜谱的数据');
      state.mode = 'server';
      state.imgBase = '/img/';
      absorb(payload);
      return state;
    } catch (e) {
      const res = await fetch('bootstrap.json');
      if (!res.ok) throw new Error('打不开菜谱数据：' + e.message);
      state.mode = 'local';
      state.imgBase = 'img/';
      state.base = await res.json();
      state.config = Object.assign({}, state.base.config, { read_only: false, mode: 'local' });
      await Local.load();
      rebuild();
      return state;
    }
  }

  const imgUrl = (file) => {
    if (!file) return null;
    const local = Local.imageUrl(file);
    if (local) return local;
    return state.imgBase + file;
  };

  function guard() {
    if (state.readOnly) {
      U.toast('这本菜谱被设成只读了（LITTLE_CHEF_READ_ONLY=1）');
      return false;
    }
    return true;
  }

  /** local 模式下自己发 id：能用拉丁文就用，不能就按时间 */
  function makeId(collection, item) {
    const seed = item.slug || item.latin || item.subtitle || '';
    let slug = String(seed).toLowerCase().normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const suffix = [...crypto.getRandomValues(new Uint32Array(2))].map(n => n.toString(16)).join('');
    slug = (slug || 'item') + '-' + suffix;
    const taken = new Set(state[collection].map((x) => x.id));
    let id = slug;
    let n = 2;
    while (taken.has(id)) { id = `${slug}-${n}`; n += 1; }
    return id;
  }

  const localCollections = { recipes: 'recipes', pantry: 'pantry', menus: 'menus' };

  async function saveLocal(collection, item) {
    const payload = Object.assign({}, item);
    if (!payload.id) payload.id = makeId(collection, payload);
    if (payload.photo_assets) {
      const assets = payload.photo_assets;
      delete payload.photo_assets;
      const suffix = [...crypto.getRandomValues(new Uint32Array(4))].map((n) => n.toString(16)).join('-');
      for (const [type, field] of [['original', 'original_image'], ['illustration', 'illustration_image']]) {
        if (assets[type]) {
          const name = `photo-${type}-${suffix}.jpg`;
          const blob = await (await fetch(assets[type])).blob();
          await Local.putImage(name, blob);
          payload[field] = name;
        } else delete payload[field];
      }
      payload.image = assets.selected === 'illustration' ? payload.illustration_image : payload.original_image;
      payload.image_provider = assets.selected === 'illustration' ? 'photo-handdrawn' : 'photo';
    }
    const saved = await Local.put(localCollections[collection], payload);
    if (payload.tags && !Array.isArray(payload.tags)) await Local.rememberTags(payload.tags);
    rebuild();
    return saved;
  }

  // ---- 写 ------------------------------------------------------------- //

  async function saveRecipe(recipe) {
    if (!guard()) return null;
    if (state.mode === 'local') return saveLocal('recipes', recipe);
    const saved = await req('/api/recipes', { method: 'POST', body: JSON.stringify(recipe) });
    const i = state.recipes.findIndex((r) => r.id === saved.id);
    if (i >= 0) state.recipes[i] = saved; else state.recipes.push(saved);
    await refreshTaxonomy();
    return saved;
  }

  async function deleteRecipe(id) {
    if (!guard()) return null;
    if (state.mode === 'local') {
      await Local.remove('recipes', id);
      rebuild();
      return true;
    }
    await req('/api/recipes/' + encodeURIComponent(id), { method: 'DELETE' });
    state.recipes = state.recipes.filter((r) => r.id !== id);
    return true;
  }

  async function addLog(id, entry) {
    if (!guard()) return null;
    if (state.mode === 'local') {
      const r = JSON.parse(JSON.stringify(recipe(id)));
      r.log = r.log || [];
      r.log.unshift({
        date: entry.date || U.today(),
        rating: entry.rating,
        note: (entry.note || '').trim(),
        cook: entry.cook || '',
        changed: entry.changed || [],
      });
      r.last_cooked = r.log.map((e) => e.date || '').sort().slice(-1)[0] || r.last_cooked;
      return saveLocal('recipes', r);
    }
    const saved = await req(`/api/recipes/${encodeURIComponent(id)}/log`, {
      method: 'POST', body: JSON.stringify(entry),
    });
    const i = state.recipes.findIndex((r) => r.id === id);
    if (i >= 0) state.recipes[i] = saved;
    return saved;
  }

  async function savePantry(item) {
    if (!guard()) return null;
    if (state.mode === 'local') return saveLocal('pantry', item);
    const saved = await req('/api/pantry', { method: 'POST', body: JSON.stringify(item) });
    const i = state.pantry.findIndex((p) => p.id === saved.id);
    if (i >= 0) state.pantry[i] = saved; else state.pantry.push(saved);
    return saved;
  }

  async function setStock(id, inStock) {
    if (!guard()) return null;
    if (state.mode === 'local') {
      const p = Object.assign({}, pantryItem(id), { in_stock: inStock, stock_checked: U.today() });
      return saveLocal('pantry', p);
    }
    const saved = await req(`/api/pantry/${encodeURIComponent(id)}/stock`, {
      method: 'POST', body: JSON.stringify({ in_stock: inStock }),
    });
    const i = state.pantry.findIndex((p) => p.id === id);
    if (i >= 0) state.pantry[i] = saved;
    return saved;
  }

  async function saveMenu(menu) {
    if (!guard()) return null;
    if (state.mode === 'local') return saveLocal('menus', menu);
    const saved = await req('/api/menus', { method: 'POST', body: JSON.stringify(menu) });
    const i = state.menus.findIndex((m) => m.id === saved.id);
    if (i >= 0) state.menus[i] = saved; else state.menus.unshift(saved);
    return saved;
  }

  async function deleteMenu(id) {
    if (!guard()) return null;
    if (state.mode === 'local') {
      await Local.remove('menus', id);
      rebuild();
      return true;
    }
    await req('/api/menus/' + encodeURIComponent(id), { method: 'DELETE' });
    state.menus = state.menus.filter((m) => m.id !== id);
    return true;
  }

  // ---- 图 ------------------------------------------------------------- //

  /** 让大模型画一张插画。需要 NAS 上配好出图模型。 */
  async function generateImage(kind, id, imagePrompt) {
    if (!guard()) return null;
    if (state.mode === 'local') {
      U.toast('画插画要家里那台 NAS 上的出图模型；现在可以先拍一张真的');
      return null;
    }
    const out = await req('/api/images/generate', {
      method: 'POST',
      body: JSON.stringify({ kind, id, image_prompt: imagePrompt || undefined }),
    });
    const list = kind === 'recipe' ? state.recipes : state.pantry;
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = out.item;
    return out;
  }

  async function preparePhoto(file) {
    if (!file || file.size > 25 * 1024 * 1024) throw new Error('请选择小于 25 MB 的照片');
    const blob = await shrink(file, 1600);
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('照片读取失败'));
      reader.readAsDataURL(blob);
    });
    return { blob, dataUrl };
  }

  async function photoAssist(action, kind, blob, signal) {
    const body = new FormData();
    body.append('file', blob, 'photo.jpg'); body.append('kind', kind);
    return req('/api/photos/' + action, { method: 'POST', body, signal });
  }

  /** 手机上拍一张 / 挑一张。缩到 1200px 存起来，别把 NAS 和浏览器塞爆。 */
  async function attachPhoto(kind, id, file) {
    if (!guard()) return null;
    const blob = await shrink(file, 1200);
    const collection = kind === 'recipe' ? 'recipes' : 'pantry';
    const item = kind === 'recipe' ? recipe(id) : pantryItem(id);
    if (!item) throw new Error('找不到要配图的东西');

    if (state.mode === 'local') {
      const name = `photo-${id}-${Date.now().toString(36)}.jpg`;
      await Local.putImage(name, blob);
      const next = Object.assign({}, item, {
        image: name, original_image: name, image_kind: 'photo', image_provider: 'photo',
        photo_taken: U.today(),
      });
      return saveLocal(collection, next);
    }

    const fd = new FormData();
    fd.append('file', blob, 'photo.jpg');
    fd.append('kind', kind);
    fd.append('id', id);
    const out = await req('/api/images/upload', { method: 'POST', body: fd });
    const list = kind === 'recipe' ? state.recipes : state.pantry;
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0 && out.item) list[i] = out.item;
    return out.item;
  }

  function shrink(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('这张图处理不了'))), 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图打不开')); };
      img.src = url;
    });
  }

  async function previewPrompt(kind, id) {
    const out = await req(`/api/images/preview-prompt?kind=${kind}&id=${encodeURIComponent(id)}`);
    return out.prompt;
  }

  async function refreshTaxonomy() {
    if (state.mode === 'local') { rebuild(); return; }
    try {
      const payload = await req('/api/bootstrap');
      state.taxonomy = payload.taxonomy;
    } catch (e) { /* 拉不到就算了 */ }
  }

  async function getSettings() {
    if (state.mode !== 'server') return null;
    return req('/api/settings');
  }

  async function saveSettings(patch) {
    if (state.mode !== 'server') throw new Error('设置只有连着家里 NAS 才改得动');
    const out = await req('/api/settings', { method: 'POST', body: JSON.stringify({ patch }) });
    if (out && out.config) {
      state.config = Object.assign({}, state.config, out.config);
      state.readOnly = !!state.config.read_only;
    }
    return out;
  }

  function setPin(pin) {
    state.pin = pin || '';
    try {
      if (pin) localStorage.setItem('kitchen-pin', pin); else localStorage.removeItem('kitchen-pin');
    } catch (_) { /* Session-only PIN when browser storage is unavailable. */ }
  }

  // ---- 本地副本的进出 -------------------------------------------------- //

  const localChanges = () => (state.mode === 'local' ? Local.count() : 0);

  async function exportNotebook() {
    if (state.mode === 'local') return Local.exportBundle(state);
    return req('/api/export');
  }

  async function importNotebook(payload) {
    if (state.mode === 'local') {
      const counts = await Local.importBundle(payload);
      rebuild();
      return counts;
    }
    return req('/api/import', { method: 'POST', body: JSON.stringify(payload) });
  }

  async function resetLocal() {
    await Local.reset();
    rebuild();
  }

  // ---- 查 ------------------------------------------------------------- //

  const facets = () => (state.taxonomy && state.taxonomy.facets) || [];
  const facet = (key) => facets().find((f) => f.key === key);
  const facetColor = (key) => (facet(key) || {}).color || '#6d675c';
  const courseRoles = () => (state.taxonomy && state.taxonomy.course_roles) || [];
  const roleOrder = (name) => {
    const r = courseRoles().find((x) => x.name === name);
    return r ? r.order : 99;
  };
  const templates = () => (state.taxonomy && state.taxonomy.menu_templates) || [];
  const buckets = () => {
    const d = ((state.taxonomy && state.taxonomy.derived_facets) || []).find((f) => f.key === 'duration');
    return (d && d.buckets) || [];
  };

  const recipe = (id) => byId(state.recipes, id);
  const pantryItem = (id) => byId(state.pantry, id);
  const pantryByName = (name) => state.pantry.find((p) => p.name === name);

  /** 一样材料在柜子里的状态：找得到就说有没有，找不到就闭嘴 */
  const stockOf = (item) => {
    const p = item.pantry ? pantryItem(item.pantry) : pantryByName(item.name);
    if (!p) return null;
    return { item: p, missing: p.in_stock === false };
  };

  /** 这个名字是不是本子里另一道菜？葱油、高汤、糖色这类「通用件」本身就是一道菜，
   *  在别的菜里当材料用。只认全名相同，宁可漏也不要乱连。 */
  const recipeByName = (name) => {
    const n = String(name || '').trim();
    if (n.length < 2) return null;
    return state.recipes.find((r) => (r.title || '').trim() === n) || null;
  };

  const tagCounts = () => {
    const counts = {};
    state.recipes.forEach((r) => {
      Object.keys(r.tags || {}).forEach((k) => {
        counts[k] = counts[k] || {};
        (r.tags[k] || []).forEach((v) => { counts[k][v] = (counts[k][v] || 0) + 1; });
      });
    });
    return counts;
  };

  function search(list, q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const hay = [
        r.title, r.subtitle, r.summary, r.notes, r.source,
        ...(r.ingredients || []).map((i) => i.name),
        ...(r.seasonings || []).map((i) => i.name),
        ...U.flatTags(r).map((t) => t.name),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  return {
    state, boot, imgUrl, preparePhoto, photoAssist, saveRecipe, deleteRecipe, addLog, savePantry, setStock,
    saveMenu, deleteMenu, generateImage, attachPhoto, previewPrompt, setPin,
    localChanges, exportNotebook, importNotebook, resetLocal,
    getSettings, saveSettings,
    facets, facet, facetColor, courseRoles, roleOrder, templates, buckets,
    recipe, pantryItem, pantryByName, stockOf, recipeByName, tagCounts, search,
  };
})();
