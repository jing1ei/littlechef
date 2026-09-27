/* views.js — 家 / 菜谱架 / 菜谱详情 / 食材柜 / 标签 */

const Views = (() => {
  function chip(facet, name, opts = {}) {
    const color = DB.facetColor(facet);
    const cls = ['tag', opts.on ? 'on' : '', opts.static ? 'tag-static' : ''].filter(Boolean).join(' ');
    const n = opts.count != null ? `<i class="tag-n">${opts.count}</i>` : '';
    const tag = opts.static ? 'span' : 'button';
    return `<${tag} class="${cls}" style="--tint:${color}" ${opts.static ? '' : `aria-pressed="${!!opts.on}"`} data-facet="${U.attr(facet)}" data-tag="${U.attr(name)}">`
      + `${U.esc(name)}${n}</${tag}>`;
  }

  function statusWashi(r) {
    const st = (r.tags && r.tags.status) || [];
    if (st.includes('传家宝')) return '<span class="washi">传家宝</span>';
    if (st.includes('想试')) return '<span class="washi want">想试</span>';
    if (st.includes('待改良')) return '<span class="washi tuning">待改良</span>';
    if (st.includes('在试')) return '<span class="washi tuning">在试</span>';
    return '';
  }

  function thumb(r) {
    const url = DB.imgUrl(r.image);
    if (url) {
      return `<div class="dish-thumb"><img src="${U.attr(url)}" alt="${U.attr(r.title)}" loading="lazy">`
        + `${statusWashi(r)}</div>`;
    }
    return `<div class="dish-thumb blank"><span>${U.esc((r.title || '菜')[0])}</span>${statusWashi(r)}</div>`;
  }

  function dishCard(r) {
    const t = (r.time && r.time.total) || 0;
    const roles = (r.course_role || []).slice(0, 1).map((x) => `<span class="role">${U.esc(x)}</span>`).join('');
    const tags = [
      ...((r.tags && r.tags.cuisine) || []).slice(0, 1).map((v) => ({ f: 'cuisine', v })),
      ...((r.tags && r.tags.flavor) || []).slice(0, 1).map((v) => ({ f: 'flavor', v })),
      ...((r.tags && r.tags.season) || []).slice(0, 1).map((v) => ({ f: 'season', v })),
    ];
    return `<a class="card dish-card" href="#/recipe/${U.attr(r.id)}">
      ${thumb(r)}
      <div class="dish-body">
        <div class="dish-title">${U.esc(r.title)}${r.favorite ? '<span class="star">✿</span>' : ''}</div>
        ${r.subtitle ? `<div class="dish-latin">${U.esc(r.subtitle)}</div>` : ''}
        <p class="dish-sum">${U.esc(r.summary || '')}</p>
        <div class="dish-meta">${roles}<span>${U.minutes(t)}</span><span class="dots">${U.dots(r.difficulty)}</span></div>
        <div class="tag-row">${tags.map((x) => chip(x.f, x.v, { static: true })).join('')}</div>
      </div>
    </a>`;
  }

  const head = (title, latin, more) => `<div class="section-head">
      <h2>${U.esc(title)}</h2><span class="latin">${U.esc(latin || '')}</span>
      ${more ? `<a class="more" href="${U.attr(more.href)}">${U.esc(more.text)} →</a>` : ''}
    </div>`;

  // ------------------------------------------------------------------ 家 --- //

  function home() {
    const s = DB.state;
    const season = U.thisSeason();
    const all = s.recipes;

    const seasonal = all.filter((r) => U.has(r, 'season', season)
      && !U.has(r, 'status', '想试')).slice(0, 4);
    const recent = all.filter((r) => r.last_cooked).sort((a, b) => (b.last_cooked || '').localeCompare(a.last_cooked || '')).slice(0, 4);
    const wish = all.filter((r) => U.has(r, 'status', '想试') || U.has(r, 'status', '在试')).slice(0, 4);
    const outOfStock = s.pantry.filter((p) => p.in_stock === false);

    const cover = DB.imgUrl('cover-kitchen.jpg');

    return `
      <section class="cover">
        <img src="${U.attr(cover)}" alt="厨房的窗台">
        <div class="cover-note">这本菜谱记的是家里真做过的东西：做成了的、还在调的、以及某天在外面吃到想复刻的。</div>
      </section>

      ${!all.length ? `<div class="note-block welcome-note"><strong>从第一道家常菜开始</strong>
        <p>点「记一道新菜」，拍张照片或直接写名字；也可以先到食材柜记录家里有什么。</p>
        <div class="btn-row"><button class="btn btn-ink" id="home-first-recipe">记一道新菜</button><a class="btn" href="#/pantry">整理食材柜</a></div></div>` : ''}
      <ul class="stats">
        <li><b>${all.length}</b><span>道菜</span></li>
        <li><b>${s.pantry.filter((p) => p.kind === 'ingredient').length}</b><span>样食材</span></li>
        <li><b>${s.pantry.filter((p) => p.kind === 'seasoning').length}</b><span>瓶调味料</span></li>
        <li><b>${all.reduce((n, r) => n + (r.log || []).length, 0)}</b><span>条试做记录</span></li>
        <li><b>${s.menus.length}</b><span>份存下的菜单</span></li>
      </ul>

      <form class="quick-search" id="home-search" role="search">
        <input class="field" id="home-q" aria-label="搜索菜谱" placeholder="想吃点什么？（菜名、食材、味型都能找）" autocomplete="off">
        <button class="btn btn-ink" type="submit">找菜谱</button>
      </form>

      ${seasonal.length ? `<section class="section">
        ${head(`${season}天该吃的`, 'In Season', { href: `#/recipes?tag=season:${encodeURIComponent(season)}`, text: '全部' })}
        <div class="grid">${seasonal.map(dishCard).join('')}</div>
      </section>` : ''}

      ${recent.length ? `<section class="section">
        ${head('最近做过', 'Lately', { href: '#/recipes?sort=recent', text: '按时间看' })}
        <div class="grid">${recent.map(dishCard).join('')}</div>
      </section>` : ''}

      ${wish.length ? `<section class="section">
        ${head('还想试的', 'To Try', { href: '#/recipes?tag=status:' + encodeURIComponent('想试'), text: '全部' })}
        <div class="grid">${wish.map(dishCard).join('')}</div>
      </section>` : ''}

      <section class="section">
        ${head('招待客人', 'Hosting')}
        <div class="grid-2">
          <a class="card" href="#/menu" style="padding:22px 24px">
            <div class="dish-title">排一桌菜</div>
            <div class="dish-latin">Build a Course Set</div>
            <p class="dish-sum" style="-webkit-line-clamp:3">说清楚几个人、什么场合、有没有忌口，
              它会从这本菜谱里挑一桌不撞味、灶台不打架的菜，顺带给出备菜时间表和采购清单。</p>
            <span class="hint">→ 现在就排</span>
          </a>
          ${s.menus.length ? `<a class="card" href="#/menus" style="padding:22px 24px">
            <div class="dish-title">存过的菜单</div>
            <div class="dish-latin">Saved Menus</div>
            <p class="dish-sum" style="-webkit-line-clamp:3">${s.menus.slice(0, 3).map((m) => U.esc(m.title || m.date)).join(' · ')}</p>
            <span class="hint">→ 翻一翻</span>
          </a>` : `<a class="card" href="#/pantry?kind=seasoning" style="padding:22px 24px">
            <div class="dish-title">调味料架</div>
            <div class="dish-latin">The Shelf</div>
            <p class="dish-sum" style="-webkit-line-clamp:3">${outOfStock.length
              ? '该补货了：' + outOfStock.slice(0, 4).map((p) => U.esc(p.name)).join('、')
              : '每一瓶怎么挑、怎么存、配什么，都记在这儿。'}</p>
            <span class="hint">→ 打开柜子</span>
          </a>`}
        </div>
      </section>`;
  }

  function homeBind(root) {
    U.qs('#home-first-recipe', root)?.addEventListener('click', () => Editor.openRecipe(null));
    const q = U.qs('#home-q', root);
    if (!q) return;
    U.qs('#home-search', root).addEventListener('submit', (e) => {
      e.preventDefault();
      if (q.value.trim()) location.hash = '#/recipes?q=' + encodeURIComponent(q.value.trim());
    });
  }

  // ------------------------------------------------------------ 菜谱架 --- //

  function recipes(params) {
    const active = parseTags(params.tag);
    const q = params.q || '';
    const sort = params.sort || 'default';
    const counts = DB.tagCounts();

    let list = DB.search(DB.state.recipes, q);
    Object.keys(active).forEach((facet) => {
      active[facet].forEach((v) => {
        if (facet === 'duration') {
          list = list.filter((r) => U.durationBucket((r.time && r.time.total) || 0, DB.buckets()) === v);
        } else if (facet === 'role') {
          list = list.filter((r) => (r.course_role || []).includes(v));
        } else {
          list = list.filter((r) => U.has(r, facet, v));
        }
      });
    });

    if (sort === 'recent') list = list.slice().sort((a, b) => (b.last_cooked || '').localeCompare(a.last_cooked || ''));
    else if (sort === 'quick') list = list.slice().sort((a, b) => ((a.time || {}).total || 0) - ((b.time || {}).total || 0));
    else if (sort === 'name') list = list.slice().sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
    else list = list.slice().sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

    const facetBlocks = DB.facets().map((f) => {
      const values = (f.values || []).filter((v) => (counts[f.key] || {})[v.name]);
      if (!values.length) return '';
      return `<div class="facet"><h3>${U.esc(f.label)}<span class="latin">${U.esc(f.latin || '')}</span></h3>
        <div class="tag-row">${values.map((v) => chip(f.key, v.name, {
          on: (active[f.key] || []).includes(v.name), count: (counts[f.key] || {})[v.name],
        })).join('')}</div></div>`;
    }).join('');

    const roleBlock = `<div class="facet"><h3>上桌位置<span class="latin">Course</span></h3>
      <div class="tag-row">${DB.courseRoles().map((r) => {
        const n = DB.state.recipes.filter((x) => (x.course_role || []).includes(r.name)).length;
        return n ? chip('role', r.name, { on: (active.role || []).includes(r.name), count: n }) : '';
      }).join('')}</div></div>`;

    const durBlock = `<div class="facet"><h3>耗时<span class="latin">Time</span></h3>
      <div class="tag-row">${DB.buckets().map((b) => {
        const n = DB.state.recipes.filter((x) => U.durationBucket((x.time || {}).total || 0, DB.buckets()) === b.name).length;
        return n ? chip('duration', b.name, { on: (active.duration || []).includes(b.name), count: n }) : '';
      }).join('')}</div></div>`;

    const chosen = Object.keys(active).reduce((n, k) => n + active[k].length, 0);
    const chosenNames = Object.keys(active).flatMap((f) => active[f]);

    // 手机上先看菜，别先看两屏筛选器：筛选收进「挑一挑」里
    return `<div class="shelf">
      <aside class="rail">
        <input class="field" id="shelf-q" aria-label="搜索菜谱" placeholder="搜菜名、食材、味型" value="${U.attr(q)}" autocomplete="off">
        <button class="rail-toggle" id="rail-toggle" aria-expanded="false" aria-controls="shelf-filters">
          <span>挑一挑</span>
          <em>${chosen ? U.esc(chosenNames.slice(0, 3).join('、')) + (chosen > 3 ? ` 等 ${chosen} 个` : '') : '按标签、时间、状态筛'}</em>
          <i>▾</i>
        </button>
        <div class="rail-inner" id="shelf-filters">
          <div class="rail-head"><span class="hint">挑一挑</span>
            ${chosen || q ? '<button class="btn btn-quiet" id="clear-filters">清空</button>' : ''}</div>
          ${roleBlock}${facetBlocks}${durBlock}
        </div>
      </aside>
      <div>
        <div class="result-line">
          <span role="status">${list.length} 道${chosen ? '（筛过）' : ''}</span>
          <span class="spacer"></span>
          <div class="sorts">
            <button data-sort="default" class="${sort === 'default' ? 'on' : ''}">收藏在前</button>
            <button data-sort="recent" class="${sort === 'recent' ? 'on' : ''}">最近做过</button>
            <button data-sort="quick" class="${sort === 'quick' ? 'on' : ''}">快的在前</button>
            <button data-sort="name" class="${sort === 'name' ? 'on' : ''}">按名字</button>
          </div>
        </div>
        ${list.length ? `<div class="grid">${list.map(dishCard).join('')}</div>`
          : `<div class="empty">
              这个组合下面还没有菜。要不要记一道？
              <div style="margin-top:14px">
                <button class="btn btn-ink" id="empty-new">记一道新菜</button>
                ${chosen || q ? '<button class="btn btn-quiet" id="empty-clear" style="margin-left:8px">先看看全部</button>' : ''}
              </div>
            </div>`}
      </div>
    </div>`;
  }

  const parseTags = (raw) => {
    const out = {};
    (raw ? String(raw).split(',') : []).forEach((pair) => {
      const [f, v] = pair.split(':');
      if (!f || !v) return;
      out[f] = out[f] || [];
      try { out[f].push(decodeURIComponent(v)); } catch (_) { out[f].push(v); }
    });
    return out;
  };

  const serializeTags = (obj) => Object.keys(obj)
    .flatMap((f) => obj[f].map((v) => `${f}:${encodeURIComponent(v)}`)).join(',');

  function recipesBind(root, params) {
    const active = parseTags(params.tag);

    const toggle = U.qs('#rail-toggle', root);
    if (toggle) toggle.addEventListener('click', () => {
      const open = U.qs('.rail', root).classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    U.qsa('.rail .tag', root).forEach((btn) => btn.addEventListener('click', () => {
      const f = btn.dataset.facet, v = btn.dataset.tag;
      active[f] = active[f] || [];
      active[f] = active[f].includes(v) ? active[f].filter((x) => x !== v) : active[f].concat(v);
      if (!active[f].length) delete active[f];
      App.go('#/recipes', Object.assign({}, params, { tag: serializeTags(active) }));
    }));

    U.qsa('.sorts button', root).forEach((b) => b.addEventListener('click', () => {
      App.go('#/recipes', Object.assign({}, params, { sort: b.dataset.sort }));
    }));

    const clear = U.qs('#clear-filters', root);
    if (clear) clear.addEventListener('click', () => App.go('#/recipes', {}));

    // 空态里的两个出口：直接开新菜、或者先松开筛选看看全部
    const emptyNew = U.qs('#empty-new', root);
    if (emptyNew) emptyNew.addEventListener('click', () => {
      if (DB.state.readOnly) { U.toast('这本菜谱被设成只读了（LITTLE_CHEF_READ_ONLY=1）'); return; }
      Editor.openRecipe(null);
    });
    const emptyClear = U.qs('#empty-clear', root);
    if (emptyClear) emptyClear.addEventListener('click', () => App.go('#/recipes', {}));

    U.bindSearch(U.qs('#shelf-q', root), (q) => App.go('#/recipes', { ...params, q }));
  }

  // ------------------------------------------------------------ 菜谱详情 --- //

  // 菜谱页上「几人份」是可以拧的，拧了所有用量跟着走。记在这儿，翻页就归零。
  let servingOverride = { id: null, n: null };

  function recipe(id) {
    const r = DB.recipe(id);
    if (!r) return '<div class="empty">找不到这道菜。<a href="#/recipes">回菜谱架</a></div>';

    const base = r.servings || 4;
    const servings = servingOverride.id === id && servingOverride.n ? servingOverride.n : base;
    const factor = servings / base;
    const scaled = Math.abs(factor - 1) > 0.05;

    const img = DB.imgUrl(r.image);
    const ing = (list, kind) => `<ul class="ing-list">${Units.scaleItems(list, factor).map((i) => {
      const stock = DB.stockOf(i);
      const sub = DB.recipeByName(i.name);
      const link = sub
        ? `<a class="n comp" href="#/recipe/${U.attr(sub.id)}" title="这是本子里的另一道菜">${U.esc(i.name)}</a>`
        : (i.pantry && DB.pantryItem(i.pantry)
          ? `<a class="n" href="#/pantry/${U.attr(i.pantry)}">${U.esc(i.name)}</a>`
          : `<span class="n">${U.esc(i.name)}</span>`);
      const precise = Units.precise(i.name, i.qty);
      return `<li class="${stock && stock.missing ? 'gone' : ''}">
        <div style="flex:1">${link}
          <span class="q" style="float:right">${U.esc(i.qty || '')}${
            precise ? `<em class="exact">${U.esc(precise)}</em>` : ''}</span>
          ${stock && stock.missing ? '<span class="lack">家里没了</span>' : ''}
          ${i.note ? `<span class="note">${U.esc(i.note)}</span>` : ''}
          ${scaled && i.qty_original && i.qty !== i.qty_original
            ? `<span class="note was">原方 ${U.esc(i.qty_original)}（${base} 人）</span>` : ''}
        </div></li>`;
    }).join('')}</ul>`;

    const tagRows = DB.facets().map((f) => {
      const vals = (r.tags || {})[f.key] || [];
      if (!vals.length) return '';
      return `<div style="display:flex;gap:10px;align-items:baseline;margin-bottom:7px">
        <span class="hint" style="min-width:3.4em;font-size:12.5px">${U.esc(f.label)}</span>
        <div class="tag-row">${vals.map((v) => `<a href="#/recipes?tag=${f.key}:${encodeURIComponent(v)}">${chip(f.key, v, { static: true })}</a>`).join('')}</div>
      </div>`;
    }).join('');

    const temps = Units.recipeTemps(r);
    const salt = Units.saltPercent(r);
    const missing = [...(r.ingredients || []), ...(r.seasonings || [])]
      .map((i) => DB.stockOf(i)).filter((s) => s && s.missing);
    const canGenerate = DB.state.mode === 'server';

    return `<p class="crumb"><a href="#/recipes">菜谱架</a> · ${(r.course_role || []).map(U.esc).join(' / ')}</p>
      <div class="recipe-head">
        <h1>${U.esc(r.title)}${r.favorite ? ' <span class="dots" style="font-size:14px">✿</span>' : ''}</h1>
        ${r.subtitle ? `<div class="latin">${U.esc(r.subtitle)}</div>` : ''}
        <p class="summary">${U.esc(r.summary || '')}</p>
      </div>

      <div class="do-bar">
        <button class="btn btn-ink big" data-act="cook">下厨模式</button>
        <button class="btn" data-act="quick-log">做了一次</button>
        <button class="btn btn-quiet" data-act="add-log">记一笔</button>
        <button class="btn btn-quiet" data-act="shop">要买什么</button>
        <button class="btn btn-quiet" data-act="edit">改这道菜</button>
      </div>

      ${img ? `<div class="recipe-hero"><img src="${U.attr(img)}" alt="${U.attr(r.title)}">
            <div class="hero-tools">
              <button class="btn btn-quiet" data-act="photo">拍一张换掉</button>
              ${canGenerate ? '<button class="btn btn-quiet" data-act="gen-image">重画插画</button>' : ''}
            </div>
          </div>`
        : `<div class="recipe-hero blank">
            <p class="hint">还没有图</p>
            <div class="btn-row" style="justify-content:center">
              <button class="btn" data-act="photo">拍一张 / 传一张</button>
              ${canGenerate ? '<button class="btn btn-quiet" data-act="gen-image">让模型画一张</button>'
                : '<span class="hint" style="align-self:center">插画要家里 NAS 上的出图模型</span>'}
            </div>
          </div>`}
      <input type="file" id="photo-input" accept="image/*" hidden>

      <div class="meta-strip">
        <span class="serv"><b>份量</b>
          <button data-serv="-1" aria-label="少一人">−</button>
          <output>${servings} 人</output>
          <button data-serv="1" aria-label="多一人">+</button>
          ${scaled ? `<em>原方 ${base} 人</em>` : ''}
        </span>
        <span><b>备料</b>${U.minutes((r.time || {}).prep)}</span>
        <span><b>下锅</b>${U.minutes((r.time || {}).cook)}</span>
        <span><b>难度</b><span class="dots">${U.dots(r.difficulty)}</span></span>
        ${r.make_ahead ? '<span><b>·</b>可以提前做</span>' : ''}
        ${r.hands_off ? '<span><b>·</b>放着不用管</span>' : ''}
        ${r.last_cooked ? `<span><b>上次做</b>${U.esc(r.last_cooked)}（${U.relDate(r.last_cooked)}）</span>` : ''}
      </div>

      ${temps.length || salt ? `<div class="numbers">
        ${temps.map((t) => `<span><b>${U.esc(t.what)}</b>${U.esc(t.label)}</span>`).join('')}
        ${salt ? `<span title="按主料重量算的，酱油、味噌里的盐折进去了"><b>盐度</b>${salt.pct}%
          <em>${salt.saltG}g 盐 / ${salt.mainG}g 主料</em></span>` : ''}
      </div>` : ''}

      ${missing.length ? `<div class="note-block lack-block">
        <strong>家里缺这些：</strong>${missing.map((s) => `<a href="#/pantry/${U.attr(s.item.id)}">${U.esc(s.item.name)}</a>`).join('、')}
        <button class="btn btn-quiet" data-act="shop" style="margin-left:8px">看采购清单</button>
      </div>` : ''}

      <div class="recipe-body">
        <div>
          ${head('材料', 'Ingredients')}
          ${ing(r.ingredients, 'i')}
          ${(r.seasonings || []).length ? head('调味', 'Seasoning') + ing(r.seasonings, 's') : ''}
          ${r.source ? `<p class="hint" style="margin-top:20px">来处：${U.esc(r.source)}</p>` : ''}
        </div>
        <div>
          ${head('做法', 'Method')}
          <ol class="steps">${(r.steps || []).map((s) => {
            const read = Units.readStep(s.text + ' ' + (s.tip || ''));
            const marks = [];
            if (read.heat) marks.push(`<span class="mk heat" title="${U.attr(read.heatHint)}">${U.esc(read.heat)}</span>`);
            read.temps.forEach((t) => marks.push(`<span class="mk temp">${U.esc(t.label)}</span>`));
            read.times.forEach((t) => marks.push(`<button class="mk time" data-timer="${t.minutes}"
              data-label="${U.attr(t.label)}">⏱ ${U.esc(t.label)}</button>`));
            return `<li>${U.esc(s.text)}
              ${marks.length ? `<span class="marks">${marks.join('')}</span>` : ''}
              ${s.tip ? `<span class="tip">${U.esc(s.tip)}</span>` : ''}</li>`;
          }).join('')}</ol>
          ${r.plating ? `<div class="note-block"><strong>装盘：</strong>${U.esc(r.plating)}</div>` : ''}
          ${r.notes ? `<div class="note-block">${U.para(r.notes)}</div>` : ''}
        </div>
      </div>

      <section class="section">
        ${head('探索记录', 'Kitchen Log')}
        ${(r.log || []).length ? `<ul class="log">${r.log.map((e) => `<li>
            <span class="when">${U.esc(e.date)}<br><span style="font-size:10.5px">${U.relDate(e.date)}</span></span>
            <span class="what">${U.esc(e.note || '做了一次')}
              ${(e.changed || []).length ? `<span class="changed">${e.changed.map((c) => `<i>${U.esc(c)}</i>`).join('')}</span>` : ''}
              ${e.rating ? `<span class="rate">${U.stars(e.rating)}</span>` : ''}
              ${e.cook ? `<span class="who">— ${U.esc(e.cook)}</span>` : ''}</span>
          </li>`).join('')}</ul>`
        : '<p class="hint">还没有记录。下次做的时候记一笔：火候、比例、哪里翻车了。</p>'}
      </section>

      <section class="section">
        ${head('标签', 'Tags')}
        ${tagRows}
      </section>`;
  }

  /** 一道菜自己的采购清单：按现在拧到的人数折算，柜子里有的标出来 */
  function shopSheet(r, servings) {
    const factor = servings / (r.servings || 4);
    const rows = (list, label) => {
      const items = Units.scaleItems(list, factor);
      if (!items.length) return '';
      return `<h4>${label}</h4><ul class="shop-one">${items.map((i) => {
        const stock = DB.stockOf(i);
        const have = stock && !stock.missing && stock.item.kind === 'seasoning';
        return `<li class="${have ? 'have' : ''}"><span class="box"></span>
          <span>${U.esc(i.name)} <span class="q">${U.esc(i.qty || '')}</span>
          ${have ? '<em>柜子里有</em>' : ''}${stock && stock.missing ? '<em class="gone">没了，要买</em>' : ''}
          ${stock && stock.item.pick ? `<span class="how">怎么挑：${U.esc(stock.item.pick)}</span>` : ''}</span></li>`;
      }).join('')}</ul>`;
    };
    if (!U.sheet.open(`<h2>${U.esc(r.title)} · 要买什么</h2>
      <div class="sub">${servings} 人份${servings !== (r.servings || 4) ? `（原方 ${r.servings || 4} 人）` : ''}</div>
      ${rows(r.ingredients, '材料')}
      ${rows(r.seasonings, '调味')}
      <p class="form-help">勾掉的是柜子里已经有的。要排一整桌的清单，去「排一桌」。</p>
      <div class="btn-row" style="margin-top:18px">
        <button class="btn" onclick="window.print()">打印</button>
        <button class="btn btn-quiet" id="cancel">关掉</button>
      </div>`)) return;
    U.qs('#cancel', U.qs('#sheet-body')).addEventListener('click', U.sheet.close);
    U.qsa('.shop-one li', U.qs('#sheet-body')).forEach((li) => li.addEventListener('click', () => li.classList.toggle('got')));
  }

  function recipeBind(root, id) {
    const r = DB.recipe(id);
    if (!r) return;
    const base = r.servings || 4;
    const servings = servingOverride.id === id && servingOverride.n ? servingOverride.n : base;

    U.qsa('[data-serv]', root).forEach((b) => b.addEventListener('click', () => {
      servingOverride = { id, n: Math.max(1, Math.min(30, servings + Number(b.dataset.serv))) };
      App.render();
    }));

    U.qsa('[data-timer]', root).forEach((b) => b.addEventListener('click', () => {
      Cook.Timers.start(Number(b.dataset.timer), b.dataset.label, r.title);
      U.toast('计时开始，到点会响');
    }));

    const file = U.qs('#photo-input', root);
    if (file) {
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        U.toast('正在收这张照片……');
        try {
          await DB.attachPhoto('recipe', id, f);
          U.toast('收好了');
          App.render();
        } catch (err) { U.toast('这张没存上：' + err.message); }
        file.value = '';
      });
    }

    U.qsa('[data-act]', root).forEach((btn) => btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      if (act === 'edit') Editor.openRecipe(r);
      if (act === 'add-log') Editor.openLog(r);
      if (act === 'quick-log') await U.action(btn, () => Editor.quickLog(r), '正在记录…');
      if (act === 'cook') Cook.open(r, servings);
      if (act === 'shop') shopSheet(r, servings);
      if (act === 'photo' && file) file.click();
      if (act === 'gen-image') Editor.generateImage('recipe', r, btn);
    }));
  }

  // ------------------------------------------------------------ 食材柜 --- //

  function pantry(params) {
    // 默认先看调味料架：家里缺的、要补的，多半是瓶瓶罐罐
    const kind = params.kind === 'ingredient' ? 'ingredient' : 'seasoning';
    const q = (params.q || '').trim();
    let list = DB.state.pantry.filter((p) => p.kind === kind);
    if (q) {
      list = list.filter((p) => [p.name, p.latin, p.taste, p.pick, p.notes, p.brand, p.where,
        (p.pairs_with || []).join(' '), (p.tags || []).join(' ')].join(' ').toLowerCase().includes(q.toLowerCase()));
    }
    const season = U.thisSeason();
    const inSeason = list.filter((p) => (p.season || []).includes(season) && kind === 'ingredient');
    const missing = DB.state.pantry.filter((p) => p.in_stock === false);

    const card = (p) => `<div class="card pantry-card" data-id="${U.attr(p.id)}">
      <div class="pantry-top">
        ${p.image ? `<a href="#/pantry/${U.attr(p.id)}"><img class="pantry-photo" src="${U.attr(DB.imgUrl(p.image))}" alt="${U.attr(p.name)}" loading="lazy"></a>` : `<div class="wash" style="background:${U.washColor(p.name)}">${U.esc((p.name || '·')[0])}</div>`}
        <div style="flex:1">
          <h3><a href="#/pantry/${U.attr(p.id)}">${U.esc(p.name)}</a></h3>
          <div class="latin">${U.esc(p.latin || '')}</div>
        </div>
        <button class="stock ${p.in_stock === false ? 'no' : 'yes'}" data-stock="${U.attr(p.id)}">${p.in_stock === false ? '没了' : '有'}</button>
      </div>
      ${p.taste ? `<p class="dish-sum" style="margin:11px 0 0;-webkit-line-clamp:2">${U.esc(p.taste)}</p>` : ''}
      <div class="tag-row" style="margin-top:10px">
        ${(p.tags || []).slice(0, 3).map((t) => `<span class="tag tag-static" style="--tint:var(--ink-faint)">${U.esc(t)}</span>`).join('')}
        ${kind === 'ingredient' ? (p.season || []).filter((x) => x !== '全年').map((s) => chip('season', s, { static: true })).join('') : ''}
      </div>
    </div>`;

    return `<div class="tabs">
        <button data-kind="seasoning" class="${kind === 'seasoning' ? 'on' : ''}">调味料架</button>
        <button data-kind="ingredient" class="${kind === 'ingredient' ? 'on' : ''}">食材柜</button>
        <span class="hint" style="margin-left:auto">${kind === 'ingredient'
          ? '怎么挑、怎么存、什么时候最好' : '什么味道、配什么、买哪个牌子'}</span>
      </div>

      <div class="quick-search" style="margin:0 0 22px">
        <input class="field" id="pantry-q" aria-label="搜索食材与调味料" placeholder="找一样东西" value="${U.attr(q)}">
        <button class="btn" id="new-pantry">记一样新的</button>
      </div>

      ${missing.length ? `<div class="note-block" style="margin-bottom:24px">
        <strong>该补货了：</strong>${missing.map((p) => `<a href="#/pantry/${U.attr(p.id)}" style="border-bottom:1px solid var(--rule)">${U.esc(p.name)}</a>`).join('、')}
      </div>` : ''}

      ${inSeason.length ? `<section class="section" style="margin-top:0">
        ${head(`${season}天正当季`, 'In Season Now')}
        <div class="grid-2">${inSeason.map(card).join('')}</div>
      </section>` : ''}

      <section class="section">
        ${head(kind === 'ingredient' ? '全部食材' : '全部调味料', kind === 'ingredient' ? 'Ingredients' : 'Seasonings')}
        ${list.length ? `<div class="grid-2">${list.map(card).join('')}</div>` : `<div class="empty">${q ? '没有找到匹配的食材或调味料。<button class="btn btn-quiet" id="pantry-clear">清空搜索</button>' : '柜子还是空的，点「记一样新的」开始记录。'}</div>`}
      </section>`;
  }

  function pantryBind(root, params) {
    U.qs('#pantry-clear', root)?.addEventListener('click', () => App.go('#/pantry', { kind: params.kind }));
    U.qsa('.tabs button', root).forEach((b) => b.addEventListener('click', () => App.go('#/pantry', { kind: b.dataset.kind })));
    U.qsa('[data-stock]', root).forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.stock;
      const item = DB.pantryItem(id);
      const next = !(item.in_stock !== false);
      await U.action(b, async () => {
        const saved = await DB.setStock(id, next);
        if (saved) { App.render(); U.toast(`${item.name}：${next ? '有' : '没了'}`); }
      });
    }));
    const nb = U.qs('#new-pantry', root);
    if (nb) nb.addEventListener('click', () => Editor.openPantry(null, params.kind === 'ingredient' ? 'ingredient' : 'seasoning'));
    U.bindSearch(U.qs('#pantry-q', root), (q) => App.go('#/pantry', { ...params, q }));
  }

  function pantryItem(id) {
    const p = DB.pantryItem(id);
    if (!p) return '<div class="empty">柜子里没有这个。<a href="#/pantry">回食材柜</a></div>';
    const used = DB.state.recipes.filter((r) => [...(r.ingredients || []), ...(r.seasonings || [])]
      .some((i) => i.pantry === id || i.name === p.name));

    const row = (label, value) => (value && String(value).trim()
      ? `<dt>${U.esc(label)}</dt><dd>${U.para(value)}</dd>` : '');

    return `<p class="crumb"><a href="#/pantry?kind=${p.kind}">${p.kind === 'seasoning' ? '调味料架' : '食材柜'}</a></p>
      <div class="recipe-head">
        <h1>${U.esc(p.name)}</h1>
        <div class="latin">${U.esc(p.latin || '')}</div>
        <p class="summary">${U.esc(p.taste || '')}</p>
      </div>

      ${p.image ? `<img class="pantry-hero" src="${U.attr(DB.imgUrl(p.image))}" alt="${U.attr(p.name)}">` : ''}
      <div class="meta-strip">
        <span><b>现在</b>${p.in_stock === false ? '没了' : '家里有'}</span>
        ${p.brand ? `<span><b>常买</b>${U.esc(p.brand)}</span>` : ''}
        ${p.where ? `<span><b>哪儿买</b>${U.esc(p.where)}</span>` : ''}
        ${(p.season || []).length ? `<span><b>季节</b>${(p.season || []).map(U.esc).join('、')}</span>` : ''}
      </div>

      <div class="recipe-body">
        <div>
          <dl class="kv">
            ${row('怎么挑', p.pick)}
            ${row('怎么存', p.store)}
            ${row('配什么', (p.pairs_with || []).join('、'))}
            ${row('可以替代', p.substitutes)}
          </dl>
          <div class="btn-row" style="margin-top:20px">
            <button class="btn" data-act="edit-pantry">改一改</button>
            <button class="btn btn-quiet" data-act="toggle-stock">${p.in_stock === false ? '标成「有」' : '标成「没了」'}</button>
          </div>
        </div>
        <div>
          ${p.notes ? head('笔记', 'Notes') + `<div class="note-block">${U.para(p.notes)}</div>` : ''}
          ${(p.log || []).length ? head('记录', 'Log') + `<ul class="log">${p.log.map((e) => `<li>
            <span class="when">${U.esc(e.date)}</span><span class="what">${U.esc(e.note)}</span></li>`).join('')}</ul>` : ''}
          ${used.length ? head('用在这些菜里', 'Used In') + `<div class="grid">${used.map(dishCard).join('')}</div>` : ''}
        </div>
      </div>`;
  }

  function pantryItemBind(root, id) {
    const p = DB.pantryItem(id);
    U.qsa('[data-act]', root).forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.act === 'edit-pantry') Editor.openPantry(p);
      if (b.dataset.act === 'toggle-stock') {
        await U.action(b, async () => {
          const saved = await DB.setStock(id, p.in_stock === false);
          if (saved) App.render();
        });
      }
    }));
  }

  // -------------------------------------------------------------- 标签 --- //

  function tags() {
    const counts = DB.tagCounts();
    const blocks = DB.facets().map((f) => {
      const values = (f.values || []).filter((v) => (counts[f.key] || {})[v.name]);
      const unused = (f.values || []).filter((v) => !(counts[f.key] || {})[v.name]);
      return `<div class="facet-block">
        <h3>${U.esc(f.label)} <span class="latin" style="font-family:var(--latin);font-size:10px;letter-spacing:.24em;color:var(--ink-faint)">${U.esc(f.latin || '')}</span></h3>
        ${f.hint ? `<p class="facet-hint">${U.esc(f.hint)}</p>` : ''}
        <div class="cloud">
          ${values.map((v) => {
            const n = (counts[f.key] || {})[v.name];
            const size = 14 + Math.min(10, n * 1.6);
            return `<a href="#/recipes?tag=${f.key}:${encodeURIComponent(v.name)}" style="font-size:${size}px;color:${DB.facetColor(f.key)}">
              ${U.esc(v.name)}<span class="n"> ${n}</span></a>`;
          }).join('')}
          ${unused.length ? `<span class="hint" style="font-size:12.5px">（还没用过：${unused.slice(0, 8).map((v) => U.esc(v.name)).join('、')}）</span>` : ''}
        </div>
      </div>`;
    }).join('');

    return `<div class="recipe-head" style="margin-bottom:24px">
        <h1>标签怎么用</h1>
        <div class="latin">The Tag System</div>
        <p class="summary">一道菜可以在每个维度上有多个标签。配菜单的时候，「主料」用来避免重复，
          「味型」用来避免撞味，「灶位」用来算灶台会不会打架，「性格」用来判断能不能提前做。
          标签体系存在 <code>data/taxonomy.json</code>，改那个文件就能改整本菜谱的分类方式。</p>
      </div>
      <div class="tagmap">${blocks}</div>`;
  }

  return {
    home, homeBind, recipes, recipesBind, recipe, recipeBind,
    pantry, pantryBind, pantryItem, pantryItemBind, tags,
    dishCard, chip, head,
  };
})();
