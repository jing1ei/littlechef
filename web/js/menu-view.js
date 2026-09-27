/* menu-view.js — 排一桌 & 存下来的菜单 */

const MenuView = (() => {
  let form = null;      // 当前的设定
  let result = null;    // 当前排出来的一桌

  function defaults() {
    const t = DB.templates()[0] || {};
    return {
      templateKey: t.key,
      guests: t.default_guests || 4,
      season: U.thisSeason(),
      serveAt: '18:30',
      diet: [],
      stations: DB.facet('station') ? DB.facet('station').values.map((v) => v.name) : [],
      effort: '正常',
      coherence: true,
      includeWishlist: false,
      locked: {},
      exclude: [],
      seed: Math.floor(Math.random() * 99999),
    };
  }

  // -------------------------------------------------------------- 表单 --- //

  function formHtml() {
    const f = form;
    const seasons = ['春', '夏', '秋', '冬'];
    const diets = (DB.facet('diet') || { values: [] }).values.map((v) => v.name);
    const stations = (DB.facet('station') || { values: [] }).values.map((v) => v.name);

    const pill = (group, value, on, label) => `<button class="tag ${on ? 'on' : ''}"
      style="--tint:${group === 'diet' ? DB.facetColor('diet') : 'var(--ink-soft)'}"
      aria-pressed="${on}" data-group="${group}" data-value="${U.attr(value)}">${U.esc(label || value)}</button>`;

    return `<div class="plan-form">
      <div class="fset">
        <label>什么场合</label>
        <div class="tag-row">${DB.templates().map((t) => pill('template', t.key, f.templateKey === t.key, t.name)).join('')}</div>
        <p class="form-help">${U.esc((DB.templates().find((t) => t.key === f.templateKey) || {}).note || '')}</p>
      </div>

      <div class="fset">
        <label>几个人</label>
        <div class="stepper">
          <button data-step="-1">−</button><output>${f.guests}</output><button data-step="1">+</button>
          <span class="unit">位</span>
        </div>
      </div>

      <div class="fset">
        <label>什么时候上桌</label>
        <div class="tag-row" style="align-items:center;gap:10px">
          <input class="field" id="serve-at" type="time" value="${U.attr(f.serveAt)}" style="width:110px">
          <span class="hint" style="font-size:13px">用来倒推时间表</span>
        </div>
      </div>

      <div class="fset">
        <label>按哪个季节挑</label>
        <div class="tag-row">${seasons.map((s) => pill('season', s, f.season === s)).join('')}</div>
      </div>

      <div class="fset">
        <label>有没有忌口</label>
        <div class="tag-row">${diets.map((d) => pill('diet', d, f.diet.includes(d))).join('')}</div>
        <p class="form-help">选了的会当硬条件筛，宁可少一道也不上不能吃的。</p>
      </div>

      <div class="fset">
        <label>今天能用的灶位</label>
        <div class="tag-row">${stations.map((s) => pill('station', s, f.stations.includes(s))).join('')}</div>
      </div>

      <div class="fset">
        <label>想花多少力气</label>
        <div class="tag-row">${Course.EFFORT.map((e) => pill('effort', e, f.effort === e)).join('')}</div>
      </div>

      <div class="fset">
        <label>味道路线</label>
        <div class="tag-row">
          ${pill('coherence', '1', f.coherence, '一条线走到底')}
          ${pill('coherence', '0', !f.coherence, '混搭')}
        </div>
      </div>

      <div class="fset">
        <label>没做过的菜</label>
        <div class="tag-row">
          ${pill('wish', '0', !f.includeWishlist, '别上桌')}
          ${pill('wish', '1', f.includeWishlist, '可以试')}
        </div>
        <p class="form-help">招待客人一般别拿「想试」的菜练手。</p>
      </div>

      <div class="btn-row plan-actions">
        <button class="btn btn-ink" id="do-plan">排一桌</button>
        <button class="btn" id="do-reroll">再来一版</button>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------ 菜单纸 --- //

  function sheetHtml(plan, opts = {}) {
    const byRole = new Map();
    plan.picks.forEach((p) => {
      if (!byRole.has(p.role)) byRole.set(p.role, []);
      byRole.get(p.role).push(p);
    });
    const roles = Array.from(byRole.keys()).sort((a, b) => DB.roleOrder(a) - DB.roleOrder(b));

    const title = opts.title || `${plan.season}天的${plan.template.name}`;
    const dateLine = opts.date
      ? `${opts.date} · ${plan.guests} 位`
      : `${U.today()} · ${plan.guests} 位 · 预计 ${U.minutes(plan.stats.activeMinutes)} 净手工`;

    let idx = 0;
    const courses = roles.map((role) => {
      const rl = DB.courseRoles().find((r) => r.name === role) || {};
      return `<div class="course-group">
        <div class="course-label">${U.esc(role)}<span style="font-family:var(--latin);font-size:9.5px;letter-spacing:.24em">${U.esc(rl.latin || '')}</span></div>
        ${byRole.get(role).map((p) => {
          idx += 1;
          return `<div class="course-item">
            <span class="idx">${String(idx).padStart(2, '0')}</span>
            <a class="nm" href="#/recipe/${U.attr(p.recipe.id)}">${U.esc(p.recipe.title)}</a>
            ${(p.why || []).length ? `<span class="why">${U.esc(p.why.join('，'))}</span>` : ''}
            ${opts.readonly ? '' : `<button class="swap" data-swap="${U.attr(p.recipe.id)}" data-role="${U.attr(role)}">换一道</button>`}
          </div>`;
        }).join('')}
      </div>`;
    }).join('');

    const gaps = plan.gaps.map((g) => `<div class="course-item gap">「${U.esc(g.role)}」空着 — ${U.esc(g.reason)}</div>`).join('');

    return `<div class="menu-sheet">
      <div class="menu-title">
        <h2>${U.esc(title)}</h2>
        <div class="latin">${U.esc(plan.template.latin || 'Menu')}</div>
        <div class="when">${U.esc(dateLine)}</div>
      </div>
      ${courses}${gaps}

      ${plan.notes.length ? `<div class="plan-notes">
        <ul style="margin:0;padding-left:18px">
          ${plan.notes.map((n) => `<li class="${n.warn ? 'warn' : ''}">${U.esc(n.text)}</li>`).join('')}
        </ul>
      </div>` : ''}
    </div>

    <section class="section">
      ${Views.head('备菜时间表', 'Run of Show')}
      <ul class="timeline">${plan.timeline.map((t) => `<li>
        <span class="clock">${U.esc(t.clock)}<span class="rel">${U.esc(t.rel)}</span></span>
        <span>${U.esc(t.text)}</span></li>`).join('')}</ul>
    </section>

    <section class="section">
      ${Views.head('采购清单', 'Shopping List')}
      <div class="grid-2">
        ${plan.shopping.map((g) => `<div class="shop-group">
          <h4>${U.esc(g.group)}</h4>
          <ul>${g.items.map((i) => `<li class="${i.have ? 'have' : ''}">
            <span class="box"></span>
            <span>${U.esc(i.name)} <span class="q">${U.esc(i.total || i.qty.join(' + '))}</span>
              ${i.notes && i.notes.length ? `<span class="how">${U.esc(i.notes.join('；'))}</span>` : ''}
              ${i.pick ? `<span class="how">挑：${U.esc(i.pick)}</span>` : ''}
              <span class="for">${U.esc(i.dishes.join('、'))}</span></span>
          </li>`).join('')}</ul>
        </div>`).join('')}
      </div>
      ${plan.seasoningGaps.length ? `<div class="note-block" style="margin-top:18px">
        <strong>调味料要补：</strong>${plan.seasoningGaps.map((s) => U.esc(s.name) + (s.where ? `（${U.esc(s.where)}）` : '')).join('、')}
      </div>` : ''}
    </section>

    ${opts.readonly ? '' : `<div class="btn-row plan-actions" style="margin-top:26px">
      <button class="btn btn-ink" id="save-menu">存下这份菜单</button>
      <button class="btn" onclick="window.print()">打印 / 存 PDF</button>
      <button class="btn btn-quiet" id="do-reroll-2">再来一版</button>
    </div>`}`;
  }

  // -------------------------------------------------------------- 视图 --- //

  function view() {
    if (!DB.templates().length) return '<div class="empty">还没有菜单模板。先导入带有菜单模板的菜谱数据，再来排一桌。<a href="#/recipes">回菜谱架</a></div>';
    if (!form) form = defaults();
    return `<div class="recipe-head" style="margin-bottom:22px">
        <a class="btn btn-quiet" href="#/menus">存过的菜单 →</a>
        <h1>排一桌</h1>
        <div class="latin">Build a Course Set</div>
        <p class="summary">从这本菜谱里挑一桌菜：主料不重复、味型不撞、灶台不打架，
          能提前做的尽量提前做。排完会给出备菜时间表和采购清单。</p>
      </div>
      <div class="planner">
        ${formHtml()}
        <div id="plan-out">${result ? sheetHtml(result) : '<div class="empty">选好人数和口味，点「排一桌」查看菜单。</div>'}</div>
      </div>`;
  }

  function replan(keepLocks) {
    if (!keepLocks) { form.locked = {}; form.exclude = []; }
    form.seed = Math.floor(Math.random() * 99999);
    result = Course.plan(form, DB.state.recipes, DB.state.taxonomy);
    const out = U.qs('#plan-out');
    if (out) {
      out.innerHTML = sheetHtml(result); bindSheet(out);
      if (!keepLocks && matchMedia('(max-width: 860px)').matches) {
        out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      }
    }
  }

  function bindSheet(root) {
    U.qsa('[data-swap]', root).forEach((b) => b.addEventListener('click', () => {
      // 其余的锁住，被换掉的排除，重排
      const locked = {};
      result.picks.forEach((p) => {
        if (p.recipe.id === b.dataset.swap) return;
        locked[p.role] = (locked[p.role] || []).concat(p.recipe.id);
      });
      form.locked = locked;
      form.exclude = (form.exclude || []).concat(b.dataset.swap);
      replan(true);
      U.toast('换了一道');
    }));

    const save = U.qs('#save-menu', root);
    if (save) save.addEventListener('click', async () => {
      const title = prompt('给这份菜单起个名字', `${result.season}天的${result.template.name}`);
      if (title == null) return;
      const menu = {
        title,
        date: U.today(),
        template: result.template.key,
        template_name: result.template.name,
        guests: result.guests,
        season: result.season,
        serve_at: form.serveAt,
        settings: {
          diet: form.diet, stations: form.stations, effort: form.effort,
          coherence: form.coherence, includeWishlist: form.includeWishlist,
        },
        dishes: result.picks.map((p) => ({ role: p.role, id: p.recipe.id, title: p.recipe.title })),
        notes: result.notes.map((n) => n.text),
      };
      await U.action(save, async () => {
        const saved = await DB.saveMenu(menu);
        if (saved) { U.toast('存好了'); location.hash = '#/menus'; }
      });
    });

    const rr = U.qs('#do-reroll-2', root);
    if (rr) rr.addEventListener('click', () => replan(false));
  }

  function bind(root) {
    U.qsa('.plan-form [data-group]', root).forEach((b) => b.addEventListener('click', () => {
      const g = b.dataset.group, v = b.dataset.value;
      if (g === 'template') {
        form.templateKey = v;
        const t = DB.templates().find((x) => x.key === v);
        if (t && t.default_guests) form.guests = t.default_guests;
      }
      if (g === 'season') form.season = v;
      if (g === 'effort') form.effort = v;
      if (g === 'coherence') form.coherence = v === '1';
      if (g === 'wish') form.includeWishlist = v === '1';
      if (g === 'diet') {
        form.diet = form.diet.includes(v) ? form.diet.filter((x) => x !== v) : form.diet.concat(v);
      }
      if (g === 'station') {
        form.stations = form.stations.includes(v)
          ? form.stations.filter((x) => x !== v) : form.stations.concat(v);
      }
      result = null;
      App.render();
    }));

    U.qsa('.stepper button', root).forEach((b) => b.addEventListener('click', () => {
      form.guests = Math.max(1, Math.min(20, form.guests + Number(b.dataset.step)));
      result = null;
      App.render();
    }));

    const t = U.qs('#serve-at', root);
    if (t) t.addEventListener('change', () => { form.serveAt = t.value || '18:30'; result = null; App.render(); });

    const go = U.qs('#do-plan', root);
    if (go) go.addEventListener('click', () => replan(false));
    const rr = U.qs('#do-reroll', root);
    if (rr) rr.addEventListener('click', () => replan(false));

    const out = U.qs('#plan-out', root);
    if (out && result) bindSheet(out);
  }

  // ---------------------------------------------------------- 存过的 --- //

  function saved() {
    const list = DB.state.menus;
    if (!list.length) {
      return `<div class="recipe-head"><h1>存过的菜单</h1><div class="latin">Saved Menus</div></div>
        <div class="empty">还没存过菜单。<a href="#/menu">去排一桌</a></div>`;
    }
    return `<div class="recipe-head" style="margin-bottom:22px">
        <h1>存过的菜单</h1><div class="latin">Saved Menus</div>
        <p class="summary">上次招待谁、上了什么菜，下次别重复。</p>
      </div>
      <div class="grid-2">${list.map((m) => `<a class="card" href="#/menu/${U.attr(m.id)}" style="padding:20px 22px">
        <div class="dish-title">${U.esc(m.title || m.date)}</div>
        <div class="dish-latin">${U.esc(m.template_name || '')} · ${U.esc(m.date || '')} · ${U.esc(String(m.guests || ''))} 位</div>
        <p class="dish-sum" style="-webkit-line-clamp:3">${(m.dishes || []).map((d) => U.esc(d.title)).join(' · ')}</p>
      </a>`).join('')}</div>`;
  }

  /** 打开一份存下来的菜单：菜是活的，时间表和清单按当前菜谱重新算 */
  function savedDetail(id) {
    const m = DB.state.menus.find((x) => x.id === id);
    if (!m) return '<div class="empty">没有这份菜单。<a href="#/menus">回列表</a></div>';
    const template = DB.templates().find((t) => t.key === m.template) || DB.templates()[0] || { name: m.template_name || '菜单' };
    const picks = (m.dishes || []).map((d) => {
      const r = DB.recipe(d.id);
      return r ? { role: d.role, recipe: r, why: [] } : null;
    }).filter(Boolean);

    const plan = {
      template, guests: m.guests || 4, season: m.season || U.thisSeason(),
      picks, gaps: (m.dishes || []).filter((d) => !DB.recipe(d.id)).map((d) => ({ role: d.role, reason: `${d.title || '这道菜'}已不在菜谱架，清单未包含它` })),
      notes: (m.notes || []).map((text) => ({ text })),
      timeline: Course.timeline(picks, m.serve_at || '18:30'),
      shopping: Course.shopping(picks, m.guests || 4),
      seasoningGaps: Course.seasoningGaps(picks),
      stats: Course.stats(picks),
    };

    return `<p class="crumb"><a href="#/menus">存过的菜单</a></p>
      ${sheetHtml(plan, { title: m.title, date: m.date, readonly: true })}
      <div class="btn-row" style="margin-top:24px">
        <button class="btn" onclick="window.print()">打印 / 存 PDF</button>
        <button class="btn btn-quiet" data-del-menu="${U.attr(m.id)}">删掉这份</button>
      </div>`;
  }

  function savedDetailBind(root) {
    const b = U.qs('[data-del-menu]', root);
    if (b) b.addEventListener('click', async () => {
      if (!confirm('删掉这份菜单？')) return;
      await U.action(b, async () => {
        const ok = await DB.deleteMenu(b.dataset.delMenu);
        if (ok) { U.toast('删掉了'); location.hash = '#/menus'; }
      }, '正在删除…');
    });
  }

  return { view, bind, saved, savedDetail, savedDetailBind, reset: () => { result = null; form = null; } };
})();
