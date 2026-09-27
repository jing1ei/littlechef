/* editor.js — 记菜、改菜、记一笔、配图 */

const Editor = (() => {
  const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

  // 别人辛辛苦苦敲了半屏子，一手滑点到蒙层就全没了 —— 不行。
  // 只要用户改过东西，关表单前问一句。保存/删除成功走 force=true 绕过。
  function armDirty(form, label) {
    let dirty = false;
    let unloading = false;
    const mark = () => { dirty = true; };
    form.addEventListener('input', mark);
    form.addEventListener('change', mark);
    const onBeforeUnload = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    U.sheet.onClose(() => window.removeEventListener('beforeunload', onBeforeUnload));
    U.sheet.guard(() => {
      if (!dirty || unloading) return true;
      const ok = confirm(`${label || '还没保存'}，真的丢掉刚才改的？`);
      if (ok) { unloading = true; window.removeEventListener('beforeunload', onBeforeUnload); }
      return ok;
    });
    return {
      release() {
        dirty = false;
        unloading = true;
        window.removeEventListener('beforeunload', onBeforeUnload);
        U.sheet.guard(null);
      },
    };
  }

  /** 一行一样材料。竖线可以用，但不是必须的 ——
   *  站在厨房里用手机打字的人，不该被要求先按出一个「|」。 */
  const parseItems = (text) => lines(text).map((l) => {
    const parsed = Units.splitLine(l);
    if (!parsed) return null;
    return Object.assign(parsed, { pantry: guessPantry(parsed.name) });
  }).filter((i) => i && i.name);

  const guessPantry = (name) => {
    const hit = DB.state.pantry.find((p) => p.name === name);
    return hit ? hit.id : null;
  };

  const itemsToText = (list) => (list || [])
    .map((i) => [i.name, i.qty, i.note].filter((x) => x !== '' && x != null).join(' | ')).join('\n');

  const parseSteps = (text) => lines(text).map((l) => {
    const [step, tip] = l.split('||').map((x) => (x || '').trim());
    return { text: step, tip: tip || '' };
  }).filter((s) => s.text);

  const stepsToText = (list) => (list || [])
    .map((s) => (s.tip ? `${s.text} || ${s.tip}` : s.text)).join('\n');

  const chipRow = (group, values, chosen, color) => `<div class="tag-row">${values.map((v) => `
    <button type="button" class="tag ${chosen.includes(v) ? 'on' : ''}" style="--tint:${color || 'var(--ink-soft)'}"
      aria-pressed="${chosen.includes(v)}" data-multi="${U.attr(group)}" data-value="${U.attr(v)}">${U.esc(v)}</button>`).join('')}</div>`;

  // ------------------------------------------------------------ 菜谱 --- //

  function openRecipe(recipe) {
    if (DB.state.readOnly) { U.toast('当前为只读模式，可在设置中开启编辑'); return; }
    const r = recipe || {
      title: '', subtitle: '', summary: '', servings: 4,
      time: { prep: 10, cook: 20 }, difficulty: 2, course_role: [], tags: {},
      ingredients: [], seasonings: [], steps: [], notes: '', source: '',
      make_ahead: false, hands_off: false, favorite: false,
    };
    const isNew = !recipe;
    const picked = JSON.parse(JSON.stringify(r.tags || {}));
    const roles = (r.course_role || []).slice();

    const facetFields = DB.facets().map((f) => `<div class="form-row">
      <label>${U.esc(f.label)}${f.hint ? ` · <span style="letter-spacing:0">${U.esc(f.hint)}</span>` : ''}</label>
      ${chipRow('tags.' + f.key, (f.values || []).map((v) => v.name), picked[f.key] || [], f.color)}
    </div>`).join('');

    if (!U.sheet.open(`
      <h2>${isNew ? '记一道新菜' : '改一改「' + U.esc(r.title) + '」'}</h2>
      <div class="sub">Recipe</div>
      <form id="recipe-form">
        ${PhotoEntry.markup(r)}
        <div class="form-cols">
          <div class="form-row"><label>叫什么</label>
            <input class="field" name="title" value="${U.attr(r.title)}" required placeholder="外婆的红烧肉"></div>
          <div class="form-row"><label>小字（拉丁文，可空）</label>
            <input class="field" name="subtitle" value="${U.attr(r.subtitle)}" placeholder="Braised Pork Belly"></div>
        </div>

        <div class="form-row"><label>一句话说清楚</label>
          <input class="field" name="summary" value="${U.attr(r.summary)}" placeholder="冰糖炒色，只用黄酒不加水"></div>

        <div class="form-cols-3">
          <div class="form-row"><label>几人份</label>
            <input class="field" name="servings" type="number" min="1" value="${U.attr(r.servings || 4)}"></div>
          <div class="form-row"><label>备料（分钟）</label>
            <input class="field" name="prep" type="number" min="0" value="${U.attr((r.time || {}).prep || 0)}"></div>
          <div class="form-row"><label>下锅（分钟）</label>
            <input class="field" name="cook" type="number" min="0" value="${U.attr((r.time || {}).cook || 0)}"></div>
        </div>

        <div class="form-cols">
          <div class="form-row"><label>难度</label>
            <select class="field" name="difficulty">
              ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(r.difficulty) === n ? 'selected' : ''}>${U.dots(n)}</option>`).join('')}
            </select></div>
          <div class="form-row"><label>上桌位置（配菜单时按这个排）</label>
            ${chipRow('roles', DB.courseRoles().map((x) => x.name), roles, 'var(--terracotta)')}</div>
        </div>

        <div class="form-row"><label>脾气</label>
          ${chipRow('flags', ['可以提前做', '放着不用管', '收藏'],
            [r.make_ahead ? '可以提前做' : '', r.hands_off ? '放着不用管' : '', r.favorite ? '收藏' : ''].filter(Boolean),
            'var(--gold)')}
        </div>

        <div class="form-row"><label>材料 — 一行一样，直接写就行</label>
          <textarea class="field" name="ingredients" rows="6"
            placeholder="五花肉 600g 三层五花带皮&#10;小葱 500g&#10;盐 适量">${U.esc(itemsToText(r.ingredients))}</textarea>
          <p class="form-help">「五花肉 600g 三层带皮」这样写就够，用量和备注会自己分开。
            名字和柜子里对得上就自动链过去；名字正好是本子里另一道菜（比如葱油），也会链过去。</p></div>

        <div class="form-row"><label>调味 — 同样一行一样</label>
          <textarea class="field" name="seasonings" rows="4"
            placeholder="绍兴黄酒 400ml 整锅只用酒&#10;生抽 3 汤匙">${U.esc(itemsToText(r.seasonings))}</textarea>
          <p class="form-help">写「3 汤匙」也行，菜谱页上会顺手换算成毫升和克。</p></div>

        <div class="form-row"><label>做法 — 一行一步，想加提醒就用 || 隔开</label>
          <textarea class="field" name="steps" rows="8"
            placeholder="中小火炒糖色到琥珀色 || 颜色到「可乐」就停手，再深一秒就苦">${U.esc(stepsToText(r.steps))}</textarea>
          <p class="form-help">句子里写了「小火」「15 分钟」「180 度」的，菜谱页和下厨模式里会自动变成
            火候提示和能按的计时器 —— 不用另填字段。</p></div>

        ${facetFields}

        <div class="form-cols">
          <div class="form-row"><label>笔记 / 下次注意</label>
            <textarea class="field" name="notes" rows="3">${U.esc(r.notes)}</textarea></div>
          <div class="form-row"><label>来处</label>
            <input class="field" name="source" value="${U.attr(r.source)}" placeholder="外婆口述 / 某家店"></div>
        </div>

        <div class="form-row"><label>装盘 / 用什么盛（可空）</label>
          <input class="field" name="plating" value="${U.attr(r.plating || '')}"
            placeholder="浅口白盘，葱丝堆在中间，最后浇热油"></div>

        <div class="form-row"><label>画面提示（可空，留空就按菜名和材料自动写）</label>
          <input class="field" name="image_prompt" value="${U.attr(r.image_prompt || '')}"
            placeholder="a small blue bowl of glossy braised pork on a linen cloth">
          ${isNew ? '' : '<button type="button" class="btn-link" id="peek-prompt" style="margin-top:6px">看看它最后会发给模型的那一句</button>'}</div>

        <div class="btn-row" style="margin-top:22px">
          <button type="submit" class="btn btn-ink">${isNew ? '记下来' : '保存'}</button>
          <button type="button" class="btn btn-quiet" id="cancel">算了</button>
          ${isNew ? '' : '<button type="button" class="btn btn-quiet" id="del" style="margin-left:auto;color:var(--terracotta)">删掉这道菜</button>'}
        </div>
      </form>`)) return;

    const root = U.qs('#sheet-body');
    const form = U.qs('#recipe-form', root);
    const photo = PhotoEntry.bind(form, 'recipe', r, (draft, baseline) => {
      for (const key of ['title', 'subtitle', 'summary', 'notes']) PhotoEntry.fill(form, key, draft[key], baseline);
      for (const key of ['ingredients', 'seasonings']) PhotoEntry.fill(form, key, itemsToText(draft[key]), baseline);
      PhotoEntry.fill(form, 'steps', stepsToText(draft.steps), baseline);
      if (!roles.length) for (const role of draft.course_role || []) {
        const button = [...form.querySelectorAll('[data-multi="roles"]')].find((b) => b.dataset.value === role);
        if (button && !button.classList.contains('on')) button.click();
      }
    });
    // 标签点选也算 dirty
    const dirtyLatch = armDirty(form, '菜谱还没保存');
    const markDirty = () => form.dispatchEvent(new Event('input'));

    U.qsa('[data-multi]', root).forEach((b) => b.addEventListener('click', () => {
      const g = b.dataset.multi, v = b.dataset.value;
      const on = b.classList.toggle('on');
      b.setAttribute('aria-pressed', String(on));
      if (g === 'roles') {
        if (on) roles.push(v); else roles.splice(roles.indexOf(v), 1);
      } else if (g.startsWith('tags.')) {
        const key = g.slice(5);
        picked[key] = picked[key] || [];
        if (on) picked[key].push(v); else picked[key] = picked[key].filter((x) => x !== v);
      }
      markDirty();
    }));

    U.qs('#cancel', root).addEventListener('click', () => U.sheet.close());
    const del = U.qs('#del', root);
    if (del) del.addEventListener('click', async () => {
      if (!confirm(`删掉「${r.title}」？（文件会移到 data/.trash，不是真删）`)) return;
      await U.action(del, async () => {
        const ok = await DB.deleteRecipe(r.id);
        if (ok) { dirtyLatch.release(); U.sheet.close(true); U.toast('删掉了'); location.hash = '#/recipes'; }
      }, '正在删除…');
    });

    // 「看看它最后会发给模型的那一句」：调用后端的 preview-prompt，看到再改画面提示
    const peek = U.qs('#peek-prompt', root);
    if (peek) peek.addEventListener('click', async () => {
      if (DB.state.mode !== 'server') { U.toast('这个要在家里那台 NAS 上才看得到'); return; }
      try {
        const prompt = await DB.previewPrompt('recipe', r.id);
        alert('拼好的画面提示：\n\n' + prompt);
      } catch (err) {
        U.toast('拿不到那句提示：' + err.message);
      }
    });

    U.submit(U.qs('#recipe-form', root), async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const flags = U.qsa('[data-multi="flags"].on', root).map((b) => b.dataset.value);
      const prep = Number(fd.get('prep')) || 0;
      const cook = Number(fd.get('cook')) || 0;
      const payload = Object.assign({}, r, {
        title: (fd.get('title') || '').trim(),
        subtitle: (fd.get('subtitle') || '').trim(),
        summary: (fd.get('summary') || '').trim(),
        servings: Number(fd.get('servings')) || 4,
        time: { prep, cook, total: prep + cook },
        difficulty: Number(fd.get('difficulty')) || 2,
        course_role: roles,
        tags: picked,
        make_ahead: flags.includes('可以提前做'),
        hands_off: flags.includes('放着不用管'),
        favorite: flags.includes('收藏'),
        ingredients: parseItems(fd.get('ingredients')),
        seasonings: parseItems(fd.get('seasonings')),
        steps: parseSteps(fd.get('steps')),
        notes: (fd.get('notes') || '').trim(),
        source: (fd.get('source') || '').trim(),
        plating: (fd.get('plating') || '').trim(),
        image_prompt: (fd.get('image_prompt') || '').trim(),
      });
      if (!payload.title) { U.toast('至少给它一个名字'); return; }
      try {
        photo.apply(payload);
        const saved = await DB.saveRecipe(payload);
        if (!saved) return;
        dirtyLatch.release();
        U.sheet.close(true);
        U.toast(isNew ? '记下来了' : '保存好了');
        location.hash = '#/recipe/' + saved.id;
        App.render();
        if (isNew && !saved.image) afterNew(saved);
      } catch (err) {
        U.toast('没存上：' + err.message);
      }
    });
  }

  /** 刚记完一道菜，顺手问一句配图 —— 但不用弹窗拦人 */
  function afterNew(saved) {
    const canGenerate = DB.state.mode === 'server' && DB.state.config.image_ready;
    U.toast(canGenerate ? '记下来了。要配图就点「让模型画一张」' : '记下来了。要配图可以拍一张真的');
  }

  // -------------------------------------------------------- 记一笔 --- //

  /** 做完了，一下就记完：今天、做过了。别的都不问。
   *  想说的话下次翻到再补 —— 做完饭的人是累的。 */
  async function quickLog(r) {
    try {
      const saved = await DB.addLog(r.id, { date: U.today(), rating: null, note: '', cook: '' });
      if (!saved) return;
      U.toast('记下了：今天做过');
      App.render();
    } catch (err) { U.toast('没记上：' + err.message); }
  }

  // 这次动了什么。厨房里的进步基本都藏在这几个字里。
  const CHANGED = ['盐/酱少了', '盐/酱多了', '火大了', '火小了', '时间长了', '时间短了',
    '换了材料', '改了比例', '这次成了'];

  function openLog(r, opts = {}) {
    if (DB.state.readOnly) { U.toast('当前为只读模式，可在设置中开启编辑'); return; }
    const chosen = [];
    if (!U.sheet.open(`
      <h2>记一笔</h2><div class="sub">${U.esc(r.title)}${opts.cooked ? ' · 刚出锅' : ''}</div>
      <form id="log-form">
        <div class="form-cols">
          <div class="form-row"><label>哪天做的</label>
            <input class="field" type="date" name="date" value="${U.attr(U.today())}"></div>
          <div class="form-row"><label>这次几分</label>
            <select class="field" name="rating">
              ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${U.stars(n)}</option>`).join('')}
            </select></div>
        </div>
        <div class="form-row"><label>这次动了什么（点一下就行，可以不点）</label>
          ${chipRow('changed', CHANGED, [], 'var(--sage)')}</div>
        <div class="form-row"><label>想说的话（可空）</label>
          <textarea class="field" name="note" rows="4"
            placeholder="糖色停得早，颜色偏浅但味道最干净。收汁 10 分钟。"></textarea></div>
        <div class="form-row"><label>谁做的（可空）</label>
          <input class="field" name="cook" placeholder="我 / 老王"></div>
        <div class="btn-row" style="margin-top:18px">
          <button class="btn btn-ink" type="submit">记下</button>
          <button class="btn btn-quiet" type="button" id="cancel">算了</button>
        </div>
      </form>`)) return;

    const root = U.qs('#sheet-body');
    const form = U.qs('#log-form', root);
    const dirtyLatch = armDirty(form, '这一笔还没保存');
    const markDirty = () => form.dispatchEvent(new Event('input'));
    U.qsa('[data-multi="changed"]', root).forEach((b) => b.addEventListener('click', () => {
      const on = b.classList.toggle('on');
      b.setAttribute('aria-pressed', String(on));
      const v = b.dataset.value;
      if (on) chosen.push(v); else chosen.splice(chosen.indexOf(v), 1);
      markDirty();
    }));
    U.qs('#cancel', root).addEventListener('click', () => U.sheet.close());
    U.submit(U.qs('#log-form', root), async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const saved = await DB.addLog(r.id, {
          date: fd.get('date'), rating: Number(fd.get('rating')),
          note: (fd.get('note') || '').trim(), cook: (fd.get('cook') || '').trim(),
          changed: chosen,
        });
        if (!saved) return;
        dirtyLatch.release();
        U.sheet.close(true);
        U.toast('记下了');
        App.render();
      } catch (err) { U.toast('没记上：' + err.message); }
    });
  }

  // -------------------------------------------------- 食材 / 调味料 --- //

  function openPantry(item, kind) {
    if (DB.state.readOnly) { U.toast('当前为只读模式，可在设置中开启编辑'); return; }
    const p = item || {
      name: '', latin: '', kind: kind || 'ingredient', tags: [], season: ['全年'],
      in_stock: true, brand: '', where: '', taste: '', pick: '', store: '',
      pairs_with: [], substitutes: '', notes: '',
    };
    const isNew = !item;
    const seasons = (DB.facet('season') || { values: [] }).values.map((v) => v.name);
    const chosenSeason = (p.season || []).slice();

    if (!U.sheet.open(`
      <h2>${isNew ? '记一样新的' : '改一改「' + U.esc(p.name) + '」'}</h2>
      <div class="sub">${p.kind === 'seasoning' ? 'Seasoning' : 'Ingredient'}</div>
      <form id="pantry-form">
        ${PhotoEntry.markup(p)}
        <div class="form-cols">
          <div class="form-row"><label>叫什么</label>
            <input class="field" name="name" value="${U.attr(p.name)}" required></div>
          <div class="form-row"><label>小字（拉丁文）</label>
            <input class="field" name="latin" value="${U.attr(p.latin)}"></div>
        </div>
        <div class="form-cols">
          <div class="form-row"><label>算哪一类</label>
            <select class="field" name="kind">
              <option value="ingredient" ${p.kind === 'ingredient' ? 'selected' : ''}>食材</option>
              <option value="seasoning" ${p.kind === 'seasoning' ? 'selected' : ''}>调味料</option>
            </select></div>
          <div class="form-row"><label>家里现在有吗</label>
            <select class="field" name="in_stock">
              <option value="1" ${p.in_stock !== false ? 'selected' : ''}>有</option>
              <option value="0" ${p.in_stock === false ? 'selected' : ''}>没了</option>
            </select></div>
        </div>
        <div class="form-row"><label>季节</label>
          ${chipRow('season', seasons, chosenSeason, DB.facetColor('season'))}</div>
        <div class="form-row"><label>什么味道</label>
          <textarea class="field" name="taste" rows="2">${U.esc(p.taste)}</textarea></div>
        <div class="form-row"><label>怎么挑</label>
          <textarea class="field" name="pick" rows="3">${U.esc(p.pick)}</textarea></div>
        <div class="form-row"><label>怎么存</label>
          <textarea class="field" name="store" rows="2">${U.esc(p.store)}</textarea></div>
        <div class="form-cols">
          <div class="form-row"><label>配什么（逗号分开）</label>
            <input class="field" name="pairs_with" value="${U.attr((p.pairs_with || []).join('、'))}"></div>
          <div class="form-row"><label>可以替代</label>
            <input class="field" name="substitutes" value="${U.attr(p.substitutes)}"></div>
        </div>
        <div class="form-cols">
          <div class="form-row"><label>常买的牌子</label>
            <input class="field" name="brand" value="${U.attr(p.brand)}"></div>
          <div class="form-row"><label>哪儿买</label>
            <input class="field" name="where" value="${U.attr(p.where)}"></div>
        </div>
        <div class="form-row"><label>自己的标签（逗号分开）</label>
          <input class="field" name="tags" value="${U.attr((p.tags || []).join('、'))}" placeholder="中式基础、发酵、时令"></div>
        <div class="form-row"><label>笔记</label>
          <textarea class="field" name="notes" rows="3">${U.esc(p.notes)}</textarea></div>
        <div class="btn-row" style="margin-top:20px">
          <button class="btn btn-ink" type="submit">${isNew ? '放进柜子' : '保存'}</button>
          <button class="btn btn-quiet" type="button" id="cancel">算了</button>
        </div>
      </form>`)) return;

    const root = U.qs('#sheet-body');
    const form = U.qs('#pantry-form', root);
    const photo = PhotoEntry.bind(form, 'pantry', p, (draft, baseline) => {
      for (const key of ['name', 'latin', 'kind', 'taste', 'pick', 'store', 'brand', 'where', 'substitutes', 'notes']) PhotoEntry.fill(form, key, draft[key], baseline);
      for (const key of ['tags', 'pairs_with']) PhotoEntry.fill(form, key, (draft[key] || []).join('、'), baseline);
    });
    const dirtyLatch = armDirty(form, p.kind === 'seasoning' ? '这瓶调味还没保存' : '这样食材还没保存');
    const markDirty = () => form.dispatchEvent(new Event('input'));
    U.qsa('[data-multi="season"]', root).forEach((b) => b.addEventListener('click', () => {
      const on = b.classList.toggle('on');
      b.setAttribute('aria-pressed', String(on));
      const v = b.dataset.value;
      if (on) chosenSeason.push(v); else chosenSeason.splice(chosenSeason.indexOf(v), 1);
      markDirty();
    }));
    U.qs('#cancel', root).addEventListener('click', () => U.sheet.close());

    U.submit(U.qs('#pantry-form', root), async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const split = (s) => String(s || '').split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
      const payload = Object.assign({}, p, {
        name: (fd.get('name') || '').trim(),
        latin: (fd.get('latin') || '').trim(),
        kind: fd.get('kind'),
        in_stock: fd.get('in_stock') === '1',
        season: chosenSeason.length ? chosenSeason : ['全年'],
        taste: (fd.get('taste') || '').trim(),
        pick: (fd.get('pick') || '').trim(),
        store: (fd.get('store') || '').trim(),
        pairs_with: split(fd.get('pairs_with')),
        substitutes: (fd.get('substitutes') || '').trim(),
        brand: (fd.get('brand') || '').trim(),
        where: (fd.get('where') || '').trim(),
        tags: split(fd.get('tags')),
        notes: (fd.get('notes') || '').trim(),
      });
      try {
        photo.apply(payload);
        const saved = await DB.savePantry(payload);
        if (!saved) return;
        dirtyLatch.release();
        U.sheet.close(true);
        U.toast(isNew ? '放好了' : '保存好了');
        if (isNew) location.hash = '#/pantry/' + saved.id;
        App.render();
      } catch (err) { U.toast('没存上：' + err.message); }
    });
  }

  // ---------------------------------------------------------- 配图 --- //

  async function generateImage(kind, entity, btn) {
    // 出图要跑模型，得在家里那台机器上。分享链接上只能拍真照片。
    if (DB.state.mode !== 'server') {
      U.toast('画图要家里 NAS 上的出图模型；这里可以先拍一张真的');
      return;
    }
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '正在画……'; }
    U.toast('正在画，这一步要等十几秒');
    try {
      const out = await DB.generateImage(kind, entity.id);
      if (!out) return;
      if (out.provider === 'placeholder') {
        U.toast('还没接上出图模型，先放了一张手绘占位图（看 README 配 LITTLE_CHEF_IMAGE_PROVIDER）');
      } else {
        U.toast('画好了');
      }
      App.render();
    } catch (err) {
      U.toast('画不出来：' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  return { openRecipe, openLog, quickLog, openPantry, generateImage };
})();
