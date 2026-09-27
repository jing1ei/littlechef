/* coursegen.js — 排一桌菜。
 *
 * 一桌好菜不是「随机挑六道」：冷热要分开、灶台只有一个、味型不能撞、
 * 主料不能重复、宴客那天人要坐得下来。这里把这些常识写成分数，
 * 然后按「大菜定调 → 其他跟上」的顺序贪心地挑。
 */

const Course = (() => {
  const EFFORT = ['轻松', '正常', '拼一把'];

  // 挑菜顺序：先定大菜（它决定一桌的调子），最后收甜点
  const PICK_ORDER = ['大菜', '热炒', '凉菜', '汤', '小食', '主食', '甜点', '饮'];

  const SHOP_GROUPS = [
    { name: '菜场 · 水产', kw: ['虾', '蟹', '鱼', '蛤', '蜊', '鱿', '贝', '蛏', '鳕', '蚬'] },
    { name: '超市 · 蛋奶豆', kw: ['鸡蛋', '蛋黄', '豆腐', '豆干', '豆皮', '牛奶', '黄油', '奶油', '淡奶油', '味噌', '雪菜', '酸奶'] },
    { name: '菜场 · 肉铺', kw: ['肉', '鸡', '鸭', '排', '腩', '牛', '羊', '肠', '骨'] },
    { name: '超市 · 米面干货', kw: ['米', '面', '糯', '话梅', '虾米', '花生', '香草荚', '桂花', '红枣', '干贝'] },
    { name: '菜场 · 蔬菜', kw: ['笋', '豆', '菜', '葱', '蒜', '姜', '番茄', '土豆', '洋葱', '菇', '藕', '香椿', '柠檬', '青柠', '香茅', '柠檬叶', '小米椒', '香菜', '迷迭香', '瓜', '茄', '椒', '芹', '萝卜'] },
  ];

  const groupOf = (name) => {
    for (const g of SHOP_GROUPS) if (g.kw.some((k) => name.includes(k))) return g.name;
    return '其他';
  };

  const hasTag = (r, facet, v) => ((r.tags || {})[facet] || []).includes(v);
  const tagList = (r, facet) => (r.tags || {})[facet] || [];
  /** 「临上桌还得守着灶」的菜：炒爆煎炸这类。炖汤煮面不算，它们自己会熟。 */
  const WOK = ['炒', '爆', '煎', '炸'];
  const isLastMinuteStove = (r) => tagList(r, 'station').includes('灶台')
    && !r.make_ahead && tagList(r, 'method').some((m) => WOK.includes(m));

  /** 忌口之间是有包含关系的：一道纯素的菜当然也算素 */
  const DIET_OK = { 素: ['素', '纯素'] };
  const dietOk = (r, want) => (want || []).every(
    (d) => (DIET_OK[d] || [d]).some((alias) => hasTag(r, 'diet', alias))
  );

  const stationOk = (r, stations) => {
    if (!stations) return true;
    const need = tagList(r, 'station');
    return !need.length || need.every((s) => s === '免火' || stations.includes(s));
  };

  function slotCounts(template, guests) {
    const slots = [];
    (template.slots || []).forEach((s) => {
      const raw = (s.base || 1) + (s.per_guest || 0) * guests;
      const n = Math.max(1, Math.min(s.max || 99, Math.round(raw)));
      for (let i = 0; i < n; i += 1) slots.push(s.role);
    });
    return slots.sort((a, b) => PICK_ORDER.indexOf(a) - PICK_ORDER.indexOf(b));
  }

  /** 硬条件：角色、忌口、开着的灶位。这些不让步。 */
  function candidates(role, recipes, opts, usedIds) {
    return recipes.filter((r) => {
      if (usedIds.has(r.id)) return false;
      if ((opts.exclude || []).includes(r.id)) return false;
      if (!(r.course_role || []).includes(role)) return false;
      if (!opts.includeWishlist && hasTag(r, 'status', '想试')) return false;
      if (!dietOk(r, opts.diet)) return false;
      if (!stationOk(r, opts.stations)) return false;
      return true;
    });
  }

  /** 软条件：菜系基调、当季、「下酒」这类要求。有货就守着，没货就让步并说一声。 */
  function poolFor(role, recipes, opts, usedIds) {
    const base = candidates(role, recipes, opts, usedIds);
    let pool = base;
    const relaxed = [];

    if ((opts.requireTraits || []).length) {
      const strict = pool.filter((r) => opts.requireTraits.every((t) => hasTag(r, 'traits', t)));
      if (strict.length) pool = strict;
      else if (base.length) relaxed.push({ kind: 'traits', want: opts.requireTraits.join('、'), role });
    }
    // 当季不是打个折那么随便：秋天上春笋这种事，宁可位置空着也不干。
    // 有当季或全年的就先只从这些里挑；实在挑不出来才退回全池，并留一句「让步了」。
    if (opts.season) {
      const strict = pool.filter((r) => {
        const seasons = tagList(r, 'season');
        return !seasons.length || seasons.includes(opts.season) || seasons.includes('全年');
      });
      if (strict.length) pool = strict;
      else if (base.length) relaxed.push({ kind: 'season', want: opts.season, role });
    }
    if ((opts.preferCuisine || []).length) {
      const strict = pool.filter((r) => opts.preferCuisine.some((c) => hasTag(r, 'cuisine', c)));
      if (strict.length) pool = strict;
      else if (base.length) relaxed.push({ kind: 'cuisine', want: opts.preferCuisine.join('/'), role });
    }
    return { pool, relaxed };
  }

  function score(r, ctx, opts, rnd) {
    let s = 0;
    const why = [];

    const status = tagList(r, 'status');
    if (status.includes('传家宝')) { s += 3; why.push('家里的传家菜'); }
    else if (status.includes('成了')) s += 2;
    else if (status.includes('在试')) s -= 0.5;
    else if (status.includes('待改良')) s -= 1.2;
    else if (status.includes('想试')) s -= 2;
    if (r.favorite) s += 1.5;

    const seasons = tagList(r, 'season');
    if (seasons.includes(opts.season)) { s += 2.5; why.push(opts.season + '天正当季'); }
    else if (seasons.includes('全年')) s += 0.6;
    else s -= 3.2;   // 秋天上春笋这种事，宁可位置空着也不干

    const cuisines = tagList(r, 'cuisine');
    if ((opts.preferCuisine || []).some((c) => cuisines.includes(c))) {
      s += 3;
      why.push('正是这套菜单的路子');
    }
    if (ctx.anchorCuisine) {
      const shares = cuisines.includes(ctx.anchorCuisine);
      if (opts.coherence && shares) { s += 1.8; why.push('和' + ctx.anchorCuisine + '这条线对得上'); }
      if (!opts.coherence && shares) s -= 0.6;
    }

    tagList(r, 'main').forEach((m) => { if (ctx.mains.has(m)) s -= 4; });
    tagList(r, 'flavor').forEach((f) => { if (ctx.flavors.has(f)) s -= 3; });
    tagList(r, 'method').forEach((m) => { if (ctx.methods.has(m)) s -= 1.4; });

    if (isLastMinuteStove(r)) {
      if (ctx.lastMinuteStove >= (opts.maxLastMinuteStove || 2)) s -= 6;
      else s -= 0.4 * ctx.lastMinuteStove;
    }
    if (tagList(r, 'station').includes('烤箱') && ctx.oven >= 1) s -= 2.5;

    const total = (r.time && r.time.total) || 0;
    if (opts.effort === '轻松') {
      if (r.make_ahead) { s += 2.2; why.push('可以前一天做完'); }
      if (r.hands_off) { s += 1.4; why.push('放着不用管'); }
      if (total > 75 && !r.make_ahead) s -= 3;
      if ((r.difficulty || 0) >= 3) s -= 1;
    } else if (opts.effort === '正常') {
      if (r.make_ahead) s += 0.8;
      if (total > 120 && !r.make_ahead) s -= 1.5;
    } else {
      s += (r.difficulty || 1) * 0.4;
      if (hasTag(r, 'traits', '手上有活')) s += 0.8;
    }

    const ago = U.daysAgo(r.last_cooked);
    if (ago == null) { s += 0.4; why.push('还没做过'); }
    else if (ago <= 10) s -= 2.2;
    else if (ago <= 30) s -= 0.8;
    else if (ago > 180) { s += 0.6; why.push('很久没做了'); }

    if (opts.guests >= 5 && hasTag(r, 'traits', '好摆盘')) s += 0.6;
    if (hasTag(r, 'traits', '快手') && opts.effort === '轻松') s += 0.6;
    if ((r.servings || 4) < opts.guests * 0.6) { s -= 1; }

    s += rnd() * 1.4;
    return { s, why: why.slice(0, 2) };
  }

  function plan(opts, recipes, taxonomy) {
    const template = (taxonomy.menu_templates || []).find((t) => t.key === opts.templateKey)
      || (taxonomy.menu_templates || [])[0];
    const guests = opts.guests || template.default_guests || 4;
    const o = {
      season: opts.season || U.thisSeason(),
      diet: opts.diet || [],
      stations: opts.stations == null ? null : opts.stations,
      effort: opts.effort || '正常',
      coherence: opts.coherence !== false,
      includeWishlist: !!opts.includeWishlist,
      exclude: opts.exclude || [],
      guests,
      preferCuisine: template.prefer_cuisine || [],
      requireTraits: template.require_traits || [],
      maxLastMinuteStove: template.max_last_minute_stove || 2,
    };
    const rnd = U.mulberry(opts.seed == null ? Date.now() % 100000 : opts.seed);

    const ctx = {
      mains: new Set(), flavors: new Set(), methods: new Set(),
      lastMinuteStove: 0, oven: 0, anchorCuisine: null,
    };

    const usedIds = new Set();
    const picks = [];
    const gaps = [];
    const compromises = [];
    const slots = slotCounts(template, guests);

    // 先安置锁住的菜（用户点了「留着这道」）
    const locked = opts.locked || {};
    Object.keys(locked).forEach((role) => {
      (locked[role] || []).forEach((id) => {
        const r = recipes.find((x) => x.id === id);
        if (r && !usedIds.has(id) && dietOk(r, o.diet) && stationOk(r, o.stations)) {
          usedIds.add(id);
          picks.push({ role, recipe: r, why: ['留着这道'], locked: true });
          absorb(r);
        }
      });
    });

    function absorb(r) {
      tagList(r, 'main').forEach((m) => ctx.mains.add(m));
      tagList(r, 'flavor').forEach((f) => ctx.flavors.add(f));
      tagList(r, 'method').forEach((m) => ctx.methods.add(m));
      if (isLastMinuteStove(r)) ctx.lastMinuteStove += 1;
      if (tagList(r, 'station').includes('烤箱')) ctx.oven += 1;
      if (!ctx.anchorCuisine) {
        const c = tagList(r, 'cuisine')[0];
        if (c) ctx.anchorCuisine = c;
      }
    }

    const wantedByRole = new Map();
    slots.forEach((role) => wantedByRole.set(role, (wantedByRole.get(role) || 0) + 1));

    Array.from(wantedByRole.keys()).forEach((role) => {
      const wanted = wantedByRole.get(role);
      let have = picks.filter((p) => p.role === role).length;
      while (have < wanted) {
        const { pool, relaxed } = poolFor(role, recipes, o, usedIds);
        relaxed.forEach((x) => {
          const seen = compromises.find((c) => c.kind === x.kind && c.role === x.role);
          if (!seen) compromises.push(x);
        });
        if (!pool.length) {
          gaps.push({ role, reason: gapReason(role, recipes, o, usedIds) });
          break;
        }
        let best = null;
        pool.forEach((r) => {
          const got = score(r, ctx, o, rnd);
          if (!best || got.s > best.s) best = { s: got.s, why: got.why, recipe: r };
        });
        usedIds.add(best.recipe.id);
        picks.push({
          role, recipe: best.recipe, why: best.why, locked: false,
          score: Math.round(best.s * 10) / 10,
        });
        absorb(best.recipe);
        have += 1;
      }
    });

    picks.sort((a, b) => PICK_ORDER.indexOf(a.role) - PICK_ORDER.indexOf(b.role));

    return {
      template, guests, season: o.season, opts: o,
      picks, gaps, compromises,
      notes: review(picks, gaps, o, template, compromises),
      timeline: timeline(picks, opts.serveAt || '18:30'),
      shopping: shopping(picks, guests),
      seasoningGaps: seasoningGaps(picks),
      stats: stats(picks),
    };
  }

  /** 到底是哪一条把这个位置卡住了？一层层往下看，只说真正的原因。 */
  function gapReason(role, recipes, o, usedIds) {
    const all = recipes.filter((r) => (r.course_role || []).includes(role));
    if (!all.length) return `菜谱里还没有「${role}」这一类，可以先记一道`;

    let pool = o.includeWishlist ? all : all.filter((r) => !hasTag(r, 'status', '想试'));
    if (!pool.length) return `${role}只有「想试」的，勾上「把想试的也算进来」才排得上`;

    const fitDiet = pool.filter((r) => dietOk(r, o.diet));
    if (o.diet.length && !fitDiet.length) {
      return `${pool.length} 道${role}里没有一道是 ${o.diet.join('、')} 的`;
    }
    pool = fitDiet;

    const fitStation = pool.filter((r) => stationOk(r, o.stations));
    if (o.stations && !fitStation.length) {
      const need = Array.from(new Set(pool.flatMap((r) => tagList(r, 'station'))));
      return `剩下的${role}都要用到 ${need.join('、')}，这次没开`;
    }
    pool = fitStation;

    const free = pool.filter((r) => !usedIds.has(r.id) && !(o.exclude || []).includes(r.id));
    if (!free.length) return `能当${role}的只有 ${pool.length} 道，都已经排在别的位置上了`;
    return `${role}这一格没挑出合适的`;
  }

  function review(picks, gaps, o, template, compromises) {
    const notes = [];
    const lastMinute = picks.filter((p) => isLastMinuteStove(p.recipe));
    const ovens = picks.filter((p) => tagList(p.recipe, 'station').includes('烤箱'));
    const ahead = picks.filter((p) => p.recipe.make_ahead);
    const activeMin = picks.filter((p) => !p.recipe.make_ahead)
      .reduce((n, p) => n + ((p.recipe.time && p.recipe.time.total) || 0), 0);

    if (lastMinute.length > (template.max_last_minute_stove || 2)) {
      notes.push({
        warn: true,
        text: `临上桌有 ${lastMinute.length} 道要现炒（${lastMinute.map((p) => p.recipe.title).join('、')}），`
          + '一个灶台会手忙脚乱。可以把其中一道换成凉菜或者提前做的。',
      });
    } else if (lastMinute.length) {
      notes.push({ text: `现炒只有 ${lastMinute.length} 道，客人到了不用一直站在灶前。` });
    }
    if (ovens.length > 1) {
      notes.push({
        warn: true,
        text: `${ovens.map((p) => p.recipe.title).join(' 和 ')} 都要烤箱，温度不一样的话得排先后。`,
      });
    }
    if (ahead.length) {
      notes.push({ text: `${ahead.length} 道可以提前做好：${ahead.map((p) => p.recipe.title).join('、')}。` });
    }
    notes.push({ text: `当天净动手时间大概 ${U.minutes(activeMin)}（提前做的那几道不算）。` });
    if (o.diet.length) notes.push({ text: `已经按 ${o.diet.join('、')} 筛过一遍。` });

    const small = picks.filter((p) => (p.recipe.servings || 4) < o.guests);
    if (small.length) {
      notes.push({
        text: `${small.map((p) => p.recipe.title).join('、')} 原本是 `
          + `${small.map((p) => p.recipe.servings || 4).join('/')} 人份，${o.guests} 个人要按比例加量。`,
      });
      notes.push({
        text: '加量时主料照倍数放，盐、酱油、糖、香料先放八成，起锅前尝一口再补 —— '
          + '这几样跟着倍数走一定过头。',
      });
      const crowded = picks.filter((p) => {
        const sv = p.recipe.servings || 4;
        return o.guests / sv >= 1.8 && tagList(p.recipe, 'method').some((m) => m === '炒' || m === '煎');
      });
      if (crowded.length) {
        notes.push({
          text: `${crowded.map((p) => p.recipe.title).join('、')} 翻了快一倍的量，锅里挤不下就分两锅炒 —— `
            + '硬塞一锅会出水，炒菜变成炖菜。',
        });
      }
    }
    gaps.forEach((g) => notes.push({ warn: true, text: `${g.role}没排上：${g.reason}。` }));
    balance(picks, o).forEach((n) => notes.push(n));
    (compromises || []).forEach((c) => {
      if (c.kind === 'cuisine') {
        notes.push({
          text: `菜谱里「${c.want}」的${c.role}还不够，先用别的菜系顶上了 —— `
            + `记一道${c.want}的${c.role}进来，这套菜单就正了。`,
        });
      } else if (c.kind === 'season') {
        notes.push({
          warn: true,
          text: `没找到当季（${c.want}）的${c.role}，只好放了一道不在季的。`
            + '想更正一点，加一道对季的候补。',
        });
      } else {
        notes.push({ text: `带「${c.want}」标签的${c.role}不够，先用别的${c.role}凑上了。` });
      }
    });
    return notes;
  }

  /** 一桌菜摆在一起，够不够立得住。
   *
   *  这几条是厨房里真会被指出来的问题：一桌全是猪肉、全是炒的、一口解腻的
   *  酸味都没有、有道菜根本不在季。会写菜谱的人不一定会看整桌 —— 单看每道
   *  菜都没错，凑在一起才显出重复。这里只提醒，不替人改。
   */
  function balance(picks, o) {
    const notes = [];
    const real = picks.filter((p) => p.role !== '饮');   // 饮品不参与荤素冷热的账
    if (real.length < 3) return notes;

    // 主料撞车
    const mainCount = new Map();
    real.forEach((p) => tagList(p.recipe, 'main').forEach((m) => {
      mainCount.set(m, (mainCount.get(m) || 0) + 1);
    }));
    const heavy = Array.from(mainCount.entries())
      .filter(([, n]) => n >= Math.max(3, Math.ceil(real.length / 2)))
      .sort((a, b) => b[1] - a[1]);
    if (heavy.length) {
      notes.push({
        warn: true,
        text: `${heavy[0][1]} 道菜的主料都是${heavy[0][0]}，一桌下来会觉得重复。`
          + '换一道换个主料，整桌立刻宽一点。',
      });
    }

    // 做法撞车：全是炒的，等于全程守着灶台，客人也吃不出层次
    const methodCount = new Map();
    real.forEach((p) => tagList(p.recipe, 'method').forEach((m) => {
      methodCount.set(m, (methodCount.get(m) || 0) + 1);
    }));
    const sameMethod = Array.from(methodCount.entries())
      .filter(([, n]) => n >= Math.max(3, Math.ceil(real.length * 0.6)));
    if (sameMethod.length) {
      notes.push({
        text: `${sameMethod[0][1]} 道都是${sameMethod[0][0]}的。换一道蒸的或者凉拌的，`
          + '嘴里和灶上都松快些。',
      });
    }

    // 一口解腻的都没有
    const flavors = new Set();
    real.forEach((p) => tagList(p.recipe, 'flavor').forEach((f) => flavors.add(f)));
    const rich = ['浓油赤酱', '咸鲜', '奶香', '咖喱', '烟熏'];
    const fresh = ['糖醋', '酸辣', '清淡', '发酵鲜', '蒜香'];
    const hasCold = real.some((p) => p.role === '凉菜');
    const richN = rich.filter((f) => flavors.has(f)).length;
    if (richN >= 2 && !fresh.some((f) => flavors.has(f)) && !hasCold) {
      notes.push({
        warn: true,
        text: '整桌偏浓，没有一道酸的或者清口的。加一道凉拌、糖醋，或者干脆切盘水果，'
          + '吃到后面才不腻。',
      });
    }

    // 不在季 —— 按用户排的那顿饭是什么季节来判，别用「今天是什么季」
    const season = o.season || U.thisSeason();
    const offSeason = real.filter((p) => {
      const s = tagList(p.recipe, 'season');
      return s.length && !s.includes('全年') && !s.includes(season);
    });
    if (offSeason.length) {
      notes.push({
        text: `${offSeason.map((p) => p.recipe.title).join('、')} 标的不是${season}天的菜 —— `
          + '材料可能不好买，或者买到了也不是最好的时候。',
      });
    }

    // 上桌顺序：凉的先、热的后、甜的最后。这套菜单里有几道是要趁热的
    const hot = real.filter((p) => ['热炒', '大菜', '汤'].includes(p.role)).length;
    if (hot >= 4) {
      notes.push({
        text: `要趁热上的有 ${hot} 道，一次别全端。分两轮上，凉菜和小食先摆着，`
          + '热菜出锅一道走一道。',
      });
    }

    return notes;
  }

  /** 倒推时间表：从上桌时间往前推 */
  function timeline(picks, serveAt) {
    const [hh, mm] = String(serveAt || '18:30').split(':').map((n) => parseInt(n, 10) || 0);
    const serve = new Date();
    serve.setHours(hh, mm, 0, 0);

    const items = [];
    const push = (offset, text, dish) => items.push({ offset, text, dish });

    // 现炒的那几道要排出先后，不能都挤在上桌前五分钟。
    // 从最后一道往前倒：一道占「自己的下锅时间 + 3 分钟洗锅装盘」，
    // 一个灶台一次只能炒一道 —— 这是家里最真实的约束。
    const stirs = picks.filter((p) => p.role === '热炒');
    const stirAt = new Map();
    let cursor = 5;                       // 最后一道离上桌留 5 分钟
    for (let i = stirs.length - 1; i >= 0; i -= 1) {
      const r = stirs[i].recipe;
      const cook = Math.max(4, (r.time && r.time.cook) || 6);
      cursor += cook;
      stirAt.set(r.id, { offset: cursor, cook });
      cursor += 3;                        // 擦锅、装盘、喘口气
    }

    picks.forEach((p) => {
      const r = p.recipe;
      const total = (r.time && r.time.total) || 20;
      const methods = tagList(r, 'method');
      const marinade = methods.includes('腌渍') || methods.includes('发酵');

      if (marinade && total >= 20) {
        push(24 * 60, `${r.title}：调好料腌起来，放冰箱`, r);
      }
      if (r.make_ahead && (total >= 90 || methods.includes('煮') && p.role === '甜点')) {
        push(24 * 60, `${r.title}：整道做好，放凉冷藏`, r);
        return;
      }
      if (p.role === '甜点' && r.make_ahead) { push(5 * 60, `${r.title}：做好进冰箱冷藏`, r); return; }
      if (p.role === '大菜' || p.role === '汤') { push(total + 40, `${r.title}：下锅开炖，之后基本不用管`, r); return; }
      if (p.role === '凉菜') { push(r.make_ahead ? 5 * 60 : 75, `${r.title}：做好放冰箱，上桌前再拌/摆盘`, r); return; }
      if (p.role === '主食') { push(Math.max(35, total + 10), `${r.title}：备料，${p.role === '主食' ? '面/饭' : ''}最后煮`, r); return; }
      if (p.role === '小食') { push(90, `${r.title}：摆好放桌上`, r); return; }
      if (p.role === '热炒') {
        const slot = stirAt.get(r.id) || { offset: 8, cook: 6 };
        push(slot.offset, `${r.title}：热锅下料，${U.minutes(slot.cook)}出锅`, r);
        return;
      }
      push(30, `${r.title}：做起来`, r);
    });

    push(24 * 60 + 30, '买菜：按下面的清单走一趟菜场', null);
    push(120, '摆桌、冰饮料、把冷菜从冰箱拿出来回一点温', null);
    push(20, '所有配菜切好摆在灶边（法式那套 mise en place）', null);
    push(0, '上桌', null);

    items.sort((a, b) => b.offset - a.offset);

    return items.map((it) => {
      const t = new Date(serve.getTime() - it.offset * 60000);
      const dayBefore = it.offset >= 20 * 60;
      return {
        clock: dayBefore ? '前一天' : `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
        rel: it.offset === 0 ? '上桌' : (dayBefore ? '' : `T-${it.offset >= 60 ? Math.round(it.offset / 60 * 10) / 10 + 'h' : it.offset + 'min'}`),
        text: it.text,
        dishId: it.dish ? it.dish.id : null,
      };
    });
  }

  function shopping(picks, guests) {
    const merged = new Map();
    picks.forEach((p) => {
      // 先按人数把每道菜的量折算好，再往一起加。
      // 从前这里写的是「600g × 1.5」，等于把乘法留给站在摊子前面的人做。
      const factor = guests / (p.recipe.servings || 4);
      Units.scaleItems(p.recipe.ingredients, factor).forEach((ing) => {
        if (!ing.name) return;
        const key = ing.name;
        const item = merged.get(key) || {
          name: ing.name, qty: [], dishes: [], pantry: ing.pantry || null, notes: [],
        };
        if (ing.qty) item.qty.push(ing.qty);
        item.dishes.push(p.recipe.title);
        // 挑法上的讲究（「要三层带皮的」）不能在合并的时候丢掉
        if (ing.note && !item.notes.includes(ing.note)) item.notes.push(ing.note);
        if (ing.pantry) item.pantry = ing.pantry;
        merged.set(key, item);
      });
    });

    const groups = new Map();
    Array.from(merged.values()).forEach((item) => {
      const p = item.pantry ? DB.pantryItem(item.pantry) : DB.pantryByName(item.name);
      item.have = !!(p && p.in_stock && p.kind === 'seasoning');
      item.pick = p ? p.pick : '';
      item.total = Units.sumQty(item.qty);       // 一共要称多少
      const g = groupOf(item.name);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(item);
    });

    const order = SHOP_GROUPS.map((g) => g.name).concat(['其他']);
    return order.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g) }));
  }

  function seasoningGaps(picks) {
    const out = new Map();
    picks.forEach((p) => (p.recipe.seasonings || []).forEach((s) => {
      const item = s.pantry ? DB.pantryItem(s.pantry) : DB.pantryByName(s.name);
      if (item && item.in_stock === false) {
        if (!out.has(item.id)) out.set(item.id, { name: item.name, where: item.where, dishes: [] });
      }
      if (item && out.has(item.id)) out.get(item.id).dishes.push(p.recipe.title);
    }));
    return Array.from(out.values());
  }

  function stats(picks) {
    const active = picks.filter((p) => !p.recipe.make_ahead)
      .reduce((n, p) => n + ((p.recipe.time && p.recipe.time.total) || 0), 0);
    const ahead = picks.filter((p) => p.recipe.make_ahead).length;
    const flavors = new Set();
    const mains = new Set();
    picks.forEach((p) => {
      tagList(p.recipe, 'flavor').forEach((f) => flavors.add(f));
      tagList(p.recipe, 'main').forEach((m) => mains.add(m));
    });
    return {
      dishes: picks.length,
      activeMinutes: active,
      aheadCount: ahead,
      flavors: Array.from(flavors),
      mains: Array.from(mains),
    };
  }

  return { plan, timeline, shopping, seasoningGaps, stats, EFFORT, PICK_ORDER, groupOf };
})();
