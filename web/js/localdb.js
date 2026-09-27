/* Browser drafts are persisted in IndexedDB over the static notebook. */

const Local = (() => {
  // Storage identifier retained so upgrades keep existing drafts and photos.
  const DB_NAME = 'kitchen-notes';
  const VERSION = 1;
  let dbp = null;

  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('这个浏览器不支持本地存储')); return; }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  };

  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };

  const EMPTY = () => ({
    recipes: {}, pantry: {}, menus: {},
    removed: { recipes: [], pantry: [], menus: [] },
    tags: {},
    updated: null,
  });

  let overlay = EMPTY();
  let committed = JSON.stringify(overlay);
  let pending = Promise.resolve();
  const serial = (fn) => (...args) => {
    const next = pending.then(() => fn(...args));
    pending = next.catch(() => {});
    return next;
  };
  const imageUrls = new Map();       // 文件名 -> blob: URL
  const imageBlobs = new Map();      // 文件名 -> Blob（导出用）

  async function load() {
    try {
      const saved = await tx('kv', 'readonly', (s) => s.get('overlay'));
      if (saved) overlay = Object.assign(EMPTY(), saved);
      committed = JSON.stringify(overlay);
      const names = await tx('images', 'readonly', (s) => s.getAllKeys());
      const blobs = await tx('images', 'readonly', (s) => s.getAll());
      (names || []).forEach((name, i) => {
        const blob = blobs[i];
        if (!blob) return;
        imageBlobs.set(name, blob);
        imageUrls.set(name, URL.createObjectURL(blob));
      });
    } catch (err) {
      console.warn('[local] 读不到本地改动：', err);
    }
    return overlay;
  }

  const persist = () => {
    overlay.updated = new Date().toISOString();
    return tx('kv', 'readwrite', (s) => s.put(overlay, 'overlay')).then(() => {
      committed = JSON.stringify(overlay);
    }).catch((err) => {
      overlay = JSON.parse(committed);
      console.warn('[local] 存不下来：', err);
      throw new Error('这台设备存不下了（浏览器空间满了或开了隐私模式）');
    });
  };

  /** 把本地改动盖在静态底本上 */
  function apply(base) {
    const merge = (collection) => {
      const removed = new Set(overlay.removed[collection] || []);
      const edits = overlay[collection] || {};
      const out = (base[collection] || [])
        .filter((x) => !removed.has(x.id))
        .map((x) => (edits[x.id] ? edits[x.id] : x));
      const known = new Set(out.map((x) => x.id));
      Object.keys(edits).forEach((id) => {
        if (!known.has(id) && !removed.has(id)) out.push(edits[id]);
      });
      return out;
    };

    const taxonomy = JSON.parse(JSON.stringify(base.taxonomy || {}));
    (taxonomy.facets || []).forEach((f) => {
      const extra = overlay.tags[f.key] || [];
      const known = new Set((f.values || []).map((v) => v.name));
      extra.forEach((name) => { if (!known.has(name)) f.values.push({ name }); });
    });

    return {
      taxonomy,
      recipes: merge('recipes'),
      pantry: merge('pantry'),
      menus: merge('menus').sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      config: base.config || {},
    };
  }

  const stamp = (item) => Object.assign({}, item, {
    updated: new Date().toISOString(),
    created: item.created || new Date().toISOString(),
  });

  async function put(collection, item) {
    const saved = stamp(item);
    overlay[collection][saved.id] = saved;
    overlay.removed[collection] = (overlay.removed[collection] || []).filter((x) => x !== saved.id);
    await persist();
    return saved;
  }

  async function remove(collection, id) {
    // 顺手把这条对象引用过的图 blob 一起释放，别让 imageUrls 里堆着看不见的 blob:URL
    const gone = overlay[collection][id];
    delete overlay[collection][id];
    if (!(overlay.removed[collection] || []).includes(id)) overlay.removed[collection].push(id);
    await persist();
    if (gone) revokeImagesFor(gone);
    return true;
  }

  function revokeImagesFor(item) {
    const names = new Set();
    for (const key of ['image', 'original_image', 'illustration_image']) if (item && item[key]) names.add(item[key]);
    (item && item.log || []).forEach((e) => {
      if (e && e.image) names.add(e.image);
      if (e && e.photo) names.add(e.photo);
    });
    names.forEach((name) => {
      if ([...Object.values(overlay.recipes), ...Object.values(overlay.pantry)].some((x) => [x.image, x.original_image, x.illustration_image].includes(name))) return;
      const url = imageUrls.get(name);
      if (url) { URL.revokeObjectURL(url); imageUrls.delete(name); }
      imageBlobs.delete(name);
      tx('images', 'readwrite', (s) => s.delete(name)).catch(() => {});
    });
  }

  /** 自己随手写的新标签，也要记住，下次是个选项 */
  async function rememberTags(tags) {
    let changed = false;
    Object.keys(tags || {}).forEach((key) => {
      (tags[key] || []).forEach((name) => {
        overlay.tags[key] = overlay.tags[key] || [];
        if (!overlay.tags[key].includes(name)) { overlay.tags[key].push(name); changed = true; }
      });
    });
    if (changed) await persist();
    return changed;
  }

  async function putImage(name, blob) {
    await tx('images', 'readwrite', (s) => s.put(blob, name));
    imageBlobs.set(name, blob);
    if (imageUrls.has(name)) URL.revokeObjectURL(imageUrls.get(name));
    imageUrls.set(name, URL.createObjectURL(blob));
    return name;
  }

  const imageUrl = (name) => imageUrls.get(name) || null;

  const count = () => Object.keys(overlay.recipes).length
    + Object.keys(overlay.pantry).length
    + Object.keys(overlay.menus).length
    + Object.keys(overlay.removed).reduce((n, k) => n + overlay.removed[k].length, 0);

  const lastChange = () => overlay.updated;

  async function reset() {
    const db = await open();
    await new Promise((resolve, reject) => {
      const t = db.transaction(['kv', 'images'], 'readwrite');
      t.objectStore('kv').delete('overlay');
      t.objectStore('images').clear();
      t.oncomplete = resolve;
      t.onerror = t.onabort = () => reject(t.error || new Error('清理失败，原数据已保留'));
    });
    overlay = EMPTY();
    committed = JSON.stringify(overlay);
    imageUrls.forEach((u) => URL.revokeObjectURL(u));
    imageUrls.clear(); imageBlobs.clear();
  }

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

  /** 导出成一份能塞回 NAS 的 JSON（照片一起打包） */
  async function exportBundle(state) {
    const images = {};
    for (const [name, blob] of imageBlobs.entries()) {
      images[name] = await blobToDataUrl(blob);
    }
    return {
      little_chef: 1,
      kitchen_notes: 1, // Legacy import compatibility.
      exported: new Date().toISOString(),
      from: 'browser',
      note: '这份是从浏览器里的副本导出的。在家里的菜谱上执行 scripts/merge_export.py 就能并回去。',
      only_local_changes: {
        recipes: Object.values(overlay.recipes),
        pantry: Object.values(overlay.pantry),
        menus: Object.values(overlay.menus),
        removed: overlay.removed,
      },
      taxonomy: state.taxonomy,
      recipes: state.recipes,
      pantry: state.pantry,
      menus: state.menus,
      images,
    };
  }

  /** 把一份导出的 JSON 读回这台设备（换手机、或者从 NAS 拷一份出来带走） */
  async function importBundle(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('导入内容必须是菜谱对象');
    const collections = ['recipes', 'pantry', 'menus'];
    const source = payload.only_local_changes || payload;
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('导入集合必须是对象');
    for (const collection of collections) {
      if (!Array.isArray(source[collection] || [])) throw new Error('菜谱集合必须是列表');
      for (const item of source[collection] || []) {
        if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(item.id) || item.id.includes('..')) throw new Error('菜谱 id 不合法');
        for (const key of ['ingredients', 'seasonings', 'steps', 'log', 'dishes']) {
          if (key in item && (!Array.isArray(item[key]) || item[key].some(x => !x || typeof x !== 'object' || Array.isArray(x)))) throw new Error(key + ' 必须是对象列表');
        }
        if (collection === 'recipes' && item.tags != null && (typeof item.tags !== 'object' || Array.isArray(item.tags) || Object.values(item.tags).some(v => !Array.isArray(v) || v.some(x => typeof x !== 'string')))) throw new Error('标签格式不正确');
        if (item.tags && Object.keys(item.tags).some(k => ['__proto__','constructor','prototype'].includes(k))) throw new Error('标签维度不合法');
        if (collection === 'pantry' && item.tags != null && !Array.isArray(item.tags)) throw new Error('食材标签必须是列表');
      }
    }
    for (const [key, ids] of Object.entries(source.removed || {})) {
      if (!collections.includes(key) || !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(id))) throw new Error('删除清单不合法');
    }
    const images = payload.images || {};
    if (typeof images !== 'object' || Array.isArray(images)) throw new Error('图片集合格式不正确');
    const decoded = new Map();
    for (const [name, dataUrl] of Object.entries(images)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..') || typeof dataUrl !== 'string' || !/^data:[^,]*;base64,/.test(dataUrl)) throw new Error('图片数据不合法');
      const raw = atob(dataUrl.split(',')[1]);
      decoded.set(name, new Blob([Uint8Array.from(raw, c => c.charCodeAt(0))], {type:dataUrl.slice(5,dataUrl.indexOf(';'))}));
      if (imageBlobs.has(name)) {
        const previous = new Uint8Array(await imageBlobs.get(name).arrayBuffer());
        if (previous.length !== raw.length || previous.some((v,i)=>v!==raw.charCodeAt(i))) throw new Error('照片重名但内容不同，请先导出备份后在空白草稿中导入');
      }
    }
    const next = JSON.parse(JSON.stringify(overlay));
    const counts = { recipes: 0, pantry: 0, menus: 0, images: 0 };
    const only = payload.only_local_changes;
    const pick = (collection) => source[collection] || [];
    for (const collection of ['recipes', 'pantry', 'menus']) {
      for (const item of pick(collection)) {
        if (item && item.id) {
          next[collection][item.id] = item;
          next.removed[collection] = next.removed[collection].filter((id) => id !== item.id);
          if (collection === 'recipes') Object.entries(item.tags || {}).forEach(([key, values]) => {
            next.tags[key] = [...new Set([...(next.tags[key] || []), ...values])];
          });
          counts[collection] += 1;
        }
      }
    }
    if (only && only.removed) {
      Object.keys(only.removed).forEach((k) => {
        (only.removed[k] || []).forEach((id) => {
          delete next[k][id];
          if (!next.removed[k].includes(id)) next.removed[k].push(id);
        });
      });
    }
    next.updated = new Date().toISOString();
    const db = await open();
    await new Promise((resolve, reject) => {
      const t = db.transaction(['kv', 'images'], 'readwrite');
      t.objectStore('kv').put(next, 'overlay');
      for (const [name, blob] of decoded) t.objectStore('images').put(blob, name);
      t.oncomplete = resolve;
      t.onerror = t.onabort = () => reject(t.error || new Error('导入失败，原数据已保留'));
    });
    overlay = next; committed = JSON.stringify(next);
    for (const [name, blob] of decoded) {
      if (imageUrls.has(name)) URL.revokeObjectURL(imageUrls.get(name));
      imageBlobs.set(name, blob); imageUrls.set(name, URL.createObjectURL(blob));
    }
    counts.images = decoded.size;
    return counts;
  }

  return {
    load, apply, put: serial(put), remove: serial(remove), rememberTags: serial(rememberTags), putImage, imageUrl,
    count, lastChange, reset: serial(reset), exportBundle, importBundle: serial(importBundle),
  };
})();
