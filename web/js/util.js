/* util.js — 小工具。没有框架，所以自己带一把螺丝刀。 */

const U = (() => {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const attr = (s) => esc(s);

  /** 一段纯文本变成段落，允许换行，不允许 HTML */
  const para = (s) => String(s || '').split(/\n{1,}/).filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`).join('');

  const el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const monthSeason = (m) => (m >= 3 && m <= 5 ? '春' : m >= 6 && m <= 8 ? '夏' : m >= 9 && m <= 11 ? '秋' : '冬');
  const thisSeason = () => monthSeason(new Date().getMonth() + 1);

  const minutes = (n) => {
    n = Number(n) || 0;
    if (n < 60) return n + ' 分钟';
    const h = Math.floor(n / 60), m = n % 60;
    return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
  };

  const durationBucket = (total, buckets) => {
    for (const b of buckets || []) if (total <= b.max) return b.name;
    return '慢工';
  };

  const dots = (n) => '●'.repeat(Math.max(0, Math.min(5, Number(n) || 0)))
    + '○'.repeat(Math.max(0, 5 - (Number(n) || 0)));

  const stars = (n) => (n ? '✿'.repeat(Math.max(0, Math.min(5, n))) : '');

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const daysAgo = (iso) => {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return null;
    const now = new Date();
    return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
      - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  };

  const relDate = (iso) => {
    const d = daysAgo(iso);
    if (d == null) return '';
    if (d <= 0) return '今天';
    if (d === 1) return '昨天';
    if (d < 30) return d + ' 天前';
    if (d < 365) return Math.round(d / 30) + ' 个月前';
    return Math.round(d / 365) + ' 年前';
  };

  /** 洗牌 + 打分用的可复现随机 */
  const mulberry = (seed) => () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  const flatTags = (r) => {
    const out = [];
    Object.keys(r.tags || {}).forEach((k) => (r.tags[k] || []).forEach((v) => out.push({ facet: k, name: v })));
    return out;
  };

  const has = (r, facet, value) => ((r.tags || {})[facet] || []).includes(value);

  const toast = (msg) => {
    const t = qs('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  };

  function bindSearch(input, update) {
    if (!input) return;
    let timer, composing = false;
    const schedule = () => {
      clearTimeout(timer);
      if (composing) return;
      timer = setTimeout(() => { if (input.isConnected) update(input.value.trim()); }, 320);
    };
    input.addEventListener('input', schedule);
    input.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
    input.addEventListener('compositionend', () => { composing = false; schedule(); });
  }

  async function action(button, run, label = '正在保存…') {
    if (button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try { return await run(); }
    catch (err) { toast('操作未完成：' + err.message); }
    finally { button.disabled = false; button.textContent = original; }
  }

  function submit(form, run) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.busy) return;
      form.dataset.busy = 'true';
      form.setAttribute('aria-busy', 'true');
      const button = form.querySelector('[type="submit"]');
      await action(button, () => run(event));
      delete form.dataset.busy;
      form.removeAttribute('aria-busy');
    });
  }

  const sheet = {
    _guard: null,
    _cleanup: null,
    _focus: null,
    open(html) {
      if (!qs('#sheet-backdrop').hidden && !sheet.close()) return false;
      sheet._focus = document.activeElement;
      qs('#sheet-body').innerHTML = html;
      qs('#sheet-backdrop').hidden = false;
      document.body.style.overflow = 'hidden';
      qs('#sheet').scrollTop = 0;
      sheet._guard = null;
      const body = qs('#sheet-body');
      const heading = body.querySelector('h2');
      if (heading) { heading.id = 'sheet-heading'; qs('#sheet').setAttribute('aria-labelledby', heading.id); }
      qsa('.form-row', body).forEach((row, index) => {
        const label = row.querySelector('label'), input = row.querySelector('input, textarea, select');
        if (label && input) { input.id = input.id || 'sheet-field-' + index; label.htmlFor = input.id; }
      });
      qsa('form > .btn-row', body).forEach((row) => row.classList.add('sheet-actions'));
      qsa('.masthead, #view, .colophon').forEach((node) => { node.inert = true; });
      qs('#sheet-close').focus();
      return true;
    },
    // Register a check that returns true to allow closing, false to abort.
    // Set to null to disarm (e.g., after successful save).
    guard(fn) { sheet._guard = typeof fn === 'function' ? fn : null; },
    onClose(fn) { const previous = sheet._cleanup; sheet._cleanup = () => { if (previous) previous(); fn(); }; },
    close(force) {
      if (qs('#sheet-backdrop').hidden) return true;
      if (force !== true && qs('#sheet-body [data-busy]')) { toast('正在保存，请稍等'); return false; }
      if (force !== true && typeof sheet._guard === 'function' && !sheet._guard()) return false;
      sheet._guard = null;
      if (sheet._cleanup) sheet._cleanup();
      sheet._cleanup = null;
      qs('#sheet-backdrop').hidden = true;
      qsa('.masthead, #view, .colophon').forEach((node) => { node.inert = false; });
      qs('#sheet-body').innerHTML = '';
      document.body.style.overflow = '';
      if (sheet._focus && sheet._focus.isConnected) sheet._focus.focus();
      sheet._focus = null;
      return true;
    },
  };

  /** 手写感的水彩底色，用名字算一个稳定的颜色 */
  const washColor = (name) => {
    const palette = [
      'rgba(124,143,107,.22)', 'rgba(193,113,79,.2)', 'rgba(143,169,184,.24)',
      'rgba(198,154,78,.22)', 'rgba(154,107,107,.2)', 'rgba(111,139,123,.22)',
    ];
    let h = 0;
    for (const ch of String(name || 'x')) h = (h * 31 + ch.codePointAt(0)) % 9973;
    return palette[h % palette.length];
  };

  return {
    esc, attr, para, el, qs, qsa, bindSearch, action, submit, monthSeason, thisSeason, minutes, durationBucket,
    dots, stars, today, daysAgo, relDate, mulberry, flatTags, has, toast, sheet, washColor,
  };
})();
