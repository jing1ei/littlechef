/* units.js — 量的换算，和从步骤文字里读出火候、温度、时间。
 *
 * 这一层的存在是为了同时伺候两种人：
 *   记菜的人只想写「3 汤匙生抽」「小火 15 分钟」，一个字都不想多写；
 *   做菜的人（尤其是想复刻自己上次那锅的人）需要克数、油温、几分钟。
 * 所以精确不靠多填字段，靠从随手写的那句话里认出来。
 */

const Units = (() => {
  // 一勺到底是多少：厨房里通用的容量，不是营养学的
  const SPOON_ML = { 汤匙: 15, 大勺: 15, 大匙: 15, 茶匙: 5, 小勺: 5, 小匙: 5, 咖啡匙: 2.5, 杯: 240, 碗: 250 };

  // 常见调味料的「一毫升有多少克」。只放家里真会用勺子量的那些。
  const DENSITY = [
    { kw: ['盐', '细盐', '海盐'], g: 1.2 },
    { kw: ['糖', '冰糖', '砂糖', '绵糖'], g: 0.85 },
    { kw: ['生抽', '老抽', '酱油', '蒸鱼豉油', '鱼露'], g: 1.15 },
    { kw: ['醋', '香醋', '米醋', '陈醋', '白醋'], g: 1.05 },
    { kw: ['油', '香油', '麻油', '橄榄油', '菜籽油'], g: 0.92 },
    { kw: ['酒', '黄酒', '料酒', '味淋', '清酒'], g: 0.99 },
    { kw: ['蜂蜜', '糖浆', '味噌', '豆瓣', '芝麻酱', '番茄酱', '蚝油'], g: 1.3 },
    { kw: ['淀粉', '生粉', '面粉', '玉米淀粉'], g: 0.55 },
    { kw: ['水', '高汤', '牛奶', '奶油'], g: 1 },
  ];

  const density = (name) => {
    const n = String(name || '');
    for (const d of DENSITY) if (d.kw.some((k) => n.includes(k))) return d.g;
    return null;
  };

  const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 };

  /** 一个量词后面跟的东西，缩放的时候要怎么取整才像人话 */
  const ROUND = [
    { kw: ['g', '克', 'ml', '毫升', 'cc'], step: (v) => (v >= 200 ? 10 : v >= 40 ? 5 : 1) },
    { kw: ['kg', '公斤', 'L', '升'], step: () => 0.1 },
    { kw: ['汤匙', '大勺', '大匙', '茶匙', '小勺', '小匙', '杯', '碗', '勺'], step: () => 0.25 },
    { kw: ['个', '只', '颗', '瓣', '根', '支', '片', '块', '条', '张', '把', '节', '枝', '尾', '棵'], step: () => 0.5 },
  ];

  const stepFor = (unit, value) => {
    for (const r of ROUND) if (r.kw.includes(unit)) return r.step(value);
    return value >= 20 ? 1 : 0.25;
  };

  const tidy = (n, unit) => {
    const step = stepFor(unit, n);
    const v = Math.round(n / step) * step;
    const out = Math.round(v * 100) / 100;
    return String(out);
  };

  // 数字 + 单位。分数（1/2）、带整数的分数（1 1/2）、中文数字、¼ 这种都算数字。
  // ⚠️ 顺序很重要：混合分数必须在纯整数之前尝试，否则「1 1/2 根」会先吃掉前面的 1，
  //    后面剩下「1/2 根」，两者拼起来乘以缩放系数就成了「2 1 根」这种鬼话。
  const NUM = '(\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?|[½⅓⅔¼¾⅛]|[一二三四五六七八九十两半])';
  const UNIT = '(kg|公斤|g|克|ml|毫升|cc|L|升|汤匙|大勺|大匙|茶匙|小勺|小匙|勺|杯|碗|个|只|颗|瓣|根|支|片|块|条|张|把|节|枝|尾|棵|人份|份)?';
  const QTY_RE = new RegExp(NUM + '\\s*' + UNIT, 'g');

  // 「2-3 个」「5～6 汤匙」「10 到 15 分钟」这类范围写法，缩放和求和都当区间处理。
  const RANGE_SEP = /^\s*[-–~～至到]\s*$/;

  const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };

  const toNumber = (raw) => {
    const s = String(raw).trim();
    if (FRACTIONS[s] != null) return FRACTIONS[s];
    if (CN_NUM[s] != null) return CN_NUM[s];
    // 「1 1/2」这种整数 + 分数写法，先拆再加
    const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixed) {
      const whole = parseFloat(mixed[1]);
      const num = parseFloat(mixed[2]);
      const den = parseFloat(mixed[3]);
      return den ? whole + num / den : whole;
    }
    if (s.includes('/')) {
      const [a, b] = s.split('/').map((x) => parseFloat(x));
      return b ? a / b : parseFloat(s);
    }
    return parseFloat(s);
  };

  /** 把「600g」「4 支（约 600g）」「1/2 根」「2-3 个」拆成能算的东西。
   *  遇到 A-B、A~B、A 到 B 这种范围写法，合成一个带 high 字段的区间 part。 */
  function parseQty(text) {
    const s = String(text || '');
    const raw = [];
    let m;
    QTY_RE.lastIndex = 0;
    while ((m = QTY_RE.exec(s)) !== null) {
      const value = toNumber(m[1]);
      if (!isFinite(value)) continue;
      raw.push({ value, unit: (m[2] || '').trim(), raw: m[0], index: m.index });
    }
    // 合并范围：相邻两个 part 之间除了分隔符没有别的字，就合成 {value, high}
    const out = [];
    for (let i = 0; i < raw.length; i += 1) {
      const cur = raw[i];
      const nxt = raw[i + 1];
      if (nxt) {
        const between = s.slice(cur.index + cur.raw.length, nxt.index);
        const unitsOk = !cur.unit || !nxt.unit || cur.unit === nxt.unit;
        if (RANGE_SEP.test(between) && unitsOk) {
          const unit = nxt.unit || cur.unit;
          out.push({
            value: cur.value,
            high: nxt.value,
            unit,
            raw: s.slice(cur.index, nxt.index + nxt.raw.length),
            sep: between,
            index: cur.index,
          });
          i += 1;
          continue;
        }
      }
      out.push(cur);
    }
    return out;
  }

  /** 缩放一个量：整串里所有「数字+单位」按比例放大，其他字照原样留着。
   *  「适量」「少许」这种没有数字的，原样返回 —— 它本来就不该被乘。
   *  「2-3 个」这种区间，两个端点都缩放，分隔符原样保留。 */
  function scaleQty(text, factor) {
    if (!text || !isFinite(factor) || Math.abs(factor - 1) < 0.01) return String(text || '');
    const parts = parseQty(text);
    if (!parts.length) return String(text);
    let out = '';
    let cursor = 0;
    parts.forEach((p) => {
      out += String(text).slice(cursor, p.index);
      if (p.high != null) {
        const lo = tidy(p.value * factor, p.unit);
        const hi = tidy(p.high * factor, p.unit);
        // 归一化分隔符：-、~、–、～、至、到 —— 单字符居中，多字符（到 / 至）两侧空格更自然
        const sepChar = (p.sep.match(/[-–~～至到]/) || ['-'])[0];
        const sep = /[至到]/.test(sepChar) ? ` ${sepChar} ` : sepChar;
        out += lo + sep + hi + (p.unit ? (/^[a-zA-Z]/.test(p.unit) ? p.unit : ' ' + p.unit) : '');
      } else {
        out += tidy(p.value * factor, p.unit) + (p.unit ? (/^[a-zA-Z]/.test(p.unit) ? p.unit : ' ' + p.unit) : '');
      }
      cursor = p.index + p.raw.length;
    });
    out += String(text).slice(cursor);
    return out.replace(/\s+/g, ' ').trim();
  }

  /** 勺子换成毫升 / 克。给想照着复刻的人看，平时藏在小字里。 */
  function precise(name, qtyText) {
    const parts = parseQty(qtyText);
    const spoon = parts.find((p) => SPOON_ML[p.unit]);
    if (!spoon) return '';
    const ml = Math.round(spoon.value * SPOON_ML[spoon.unit] * 10) / 10;
    const d = density(name);
    if (d) {
      const g = Math.round(ml * d);
      return `≈ ${ml} ml / ${g} g`;
    }
    return `≈ ${ml} ml`;
  }

  /** 一份食材列表按人数折算 */
  const scaleItems = (list, factor) => (list || []).map((i) => Object.assign({}, i, {
    qty: scaleQty(i.qty, factor),
    qty_original: i.qty,
  }));

  // ------------------------------------------------------------------ //
  // 把好几道菜里同一样东西的用量加起来
  // ------------------------------------------------------------------ //

  // 同一族里换算成基准单位，好加。跨族的（500g 和 2 根）加不了，就分开写。
  const FAMILY = {
    g: { base: 'g', k: 1 }, 克: { base: 'g', k: 1 },
    kg: { base: 'g', k: 1000 }, 公斤: { base: 'g', k: 1000 },
    ml: { base: 'ml', k: 1 }, 毫升: { base: 'ml', k: 1 }, cc: { base: 'ml', k: 1 },
    L: { base: 'ml', k: 1000 }, 升: { base: 'ml', k: 1000 },
    // 勺子也是体积，能跟 ml 加在一起；但只有勺子的时候还是写勺子 ——
    // 买菜的人看「3 汤匙」懂，看「45ml 虾米」要愣一下。
    汤匙: { base: 'ml', k: 15, spoon: true }, 大勺: { base: 'ml', k: 15, spoon: true },
    大匙: { base: 'ml', k: 15, spoon: true },
    茶匙: { base: 'ml', k: 5, spoon: true }, 小勺: { base: 'ml', k: 5, spoon: true },
    小匙: { base: 'ml', k: 5, spoon: true },
    杯: { base: 'ml', k: 240, spoon: true },
  };

  const COUNT_UNITS = ['个', '只', '颗', '瓣', '根', '支', '片', '块', '条', '张', '把', '节', '枝', '尾', '棵'];

  const pretty = (value, base) => {
    if (base === 'g' && value >= 1000) return `${tidy(value / 1000, 'kg')}kg`;
    if (base === 'ml' && value >= 1000) return `${tidy(value / 1000, 'L')}L`;
    return `${tidy(value, base)}${base}`;
  };

  /** 只有勺子的时候，把毫升还原成勺子说 */
  const prettySpoon = (ml) => {
    if (ml >= 240 && ml % 240 === 0) return `${tidy(ml / 240, '杯')} 杯`;
    if (ml >= 15) return `${tidy(ml / 15, '汤匙')} 汤匙`;
    return `${tidy(ml / 5, '茶匙')} 茶匙`;
  };

  /** 把一串用量字符串加成一句人话。
   *
   *  ['600g', '300g']        → '900g'
   *  ['1 汤匙', '2 茶匙']     → '1.75 汤匙'（勺子都是体积，能加）
   *  ['500g', '2 根']        → '500g + 2 根'（不是一回事，分开写）
   *  ['适量', '少许']         → '适量'
   *
   *  买菜的人要的是「一共称多少」，不是「600g × 1.5、300g」这种让人站在
   *  摊子前面做算术的写法。按根按个的往上取整 —— 宁可多买一根葱。
   */
  function sumQty(list) {
    const totals = new Map();     // base -> value
    const spoonOnly = new Map();  // base -> 是不是全从勺子来的
    const loose = [];             // 加不了的，原样留着
    let vague = false;

    (list || []).forEach((raw) => {
      const text = String(raw || '').trim();
      if (!text) return;
      if (VAGUE.test(text)) { vague = true; return; }
      const parts = parseQty(text);
      if (!parts.length) { loose.push(text); return; }
      // 一条里出现好几个数字（比如「1 汤匙 + 1 茶匙」）就都算进去
      let counted = 0;
      parts.forEach((p) => {
        const fam = FAMILY[p.unit];
        if (fam) {
          // 范围「2-3 汤匙」按中值合总，避免虚高或虚低
          const v = p.high != null ? (p.value + p.high) / 2 : p.value;
          totals.set(fam.base, (totals.get(fam.base) || 0) + v * fam.k);
          const prev = spoonOnly.get(fam.base);
          spoonOnly.set(fam.base, prev === undefined ? !!fam.spoon : prev && !!fam.spoon);
          counted += 1;
        }
      });
      if (!counted) loose.push(text);
    });

    const out = [];
    ['g', 'ml'].forEach((base) => {
      if (!totals.has(base)) return;
      const v = totals.get(base);
      out.push(base === 'ml' && spoonOnly.get(base) ? prettySpoon(v) : pretty(v, base));
    });
    // 「2 根」「3 片」这类按个数的，同单位的合并
    const byUnit = new Map();
    const rest = [];
    loose.forEach((text) => {
      const parts = parseQty(text);
      if (parts.length === 1 && parts[0].unit && text.replace(parts[0].raw, '').trim() === '') {
        const p = parts[0];
        const v = p.high != null ? (p.value + p.high) / 2 : p.value;
        byUnit.set(p.unit, (byUnit.get(p.unit) || 0) + v);
      } else if (parts.length === 1 && !parts[0].unit && text.trim() === parts[0].raw.trim()) {
        const p = parts[0];
        const v = p.high != null ? (p.value + p.high) / 2 : p.value;
        byUnit.set('', (byUnit.get('') || 0) + v);
      } else {
        rest.push(text);
      }
    });
    byUnit.forEach((v, unit) => {
      // 半根葱、半个蛋没法买，往上凑个整
      const n = COUNT_UNITS.includes(unit) && v > 1 ? Math.ceil(v - 0.05) : v;
      out.push(unit ? `${tidy(n, unit)} ${unit}` : String(tidy(n, '')));
    });
    rest.forEach((t) => out.push(t));

    if (!out.length) return vague ? '适量' : '';
    return out.join(' + ') + (vague ? '（另有适量的）' : '');
  }

  // ------------------------------------------------------------------ //
  // 从步骤文字里读火候、温度、时间
  // ------------------------------------------------------------------ //

  const HEAT_WORDS = ['最小火', '微火', '中小火', '中大火', '小火', '中火', '大火', '文火', '猛火', '余温'];

  /** 火候大概对应什么油温 / 锅温，给想量化的人一个参考 */
  const HEAT_HINT = {
    最小火: '锅面 90–110°C，几乎不冒烟',
    微火: '锅面 90–110°C',
    文火: '锅面 100–120°C',
    小火: '油温 120–140°C，下料只轻微起泡',
    中小火: '油温 140–160°C',
    中火: '油温 160–180°C',
    中大火: '油温 180–200°C',
    大火: '油温 200°C 以上，锅要冒青烟',
    猛火: '油温 220°C，爆炒用',
  };

  const TIME_RE = /(\d+(?:\.\d+)?)\s*(小时|分钟|分|秒)(?:\s*(?:到|~|-|—)\s*(\d+(?:\.\d+)?)\s*(小时|分钟|分|秒)?)?/g;
  const TEMP_RE = /(\d{2,3})\s*(?:°\s*C|℃|度)/g;

  const toMinutes = (v, unit) => (unit === '小时' ? v * 60 : unit === '秒' ? v / 60 : v);

  /** 一步里能量化的东西：几分钟、多少度、什么火。用来长出计时器和温度提示。 */
  function readStep(text) {
    const s = String(text || '');
    const times = [];
    let m;
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(s)) !== null) {
      // 「15 分钟到 20 分钟」这种取长的那头：宁可早看一眼，不要过头
      const lo = toMinutes(parseFloat(m[1]), m[2]);
      const hi = m[3] ? toMinutes(parseFloat(m[3]), m[4] || m[2]) : null;
      times.push({ minutes: hi ? Math.max(lo, hi) : lo, label: m[0].replace(/\s+/g, ''), lo, hi });
    }
    const temps = [];
    TEMP_RE.lastIndex = 0;
    while ((m = TEMP_RE.exec(s)) !== null) temps.push({ c: parseInt(m[1], 10), label: m[1] + '°C' });

    const heat = HEAT_WORDS.find((w) => s.includes(w)) || null;
    return { times, temps, heat, heatHint: heat ? HEAT_HINT[heat] || '' : '' };
  }

  /** 整道菜里出现过的温度：烤箱、油温、中心温度。菜谱页上单独列一行。 */
  function recipeTemps(recipe) {
    const seen = new Map();
    (recipe.steps || []).forEach((s) => {
      readStep(s.text + ' ' + (s.tip || '')).temps.forEach((t) => {
        const near = (s.text + s.tip).includes('中心') ? '中心温度'
          : (s.text + s.tip).match(/烤箱|预热|烘/) ? '烤箱'
            : (s.text + s.tip).match(/油温|炸/) ? '油温' : '温度';
        const key = near + t.c;
        if (!seen.has(key)) seen.set(key, { what: near, label: t.label });
      });
    });
    return Array.from(seen.values());
  }

  /** 盐量占主料的百分比 —— 厨师用来复刻，家里人用来判断「是不是又咸了」。
   *  只有当主料能称重、盐也写了量的时候才算，算不出来就闭嘴。 */
  function saltPercent(recipe) {
    const grams = (list, filter) => (list || []).reduce((sum, i) => {
      if (filter && !filter(i)) return sum;
      const p = parseQty(i.qty).find((x) => ['g', '克', 'kg', '公斤'].includes(x.unit));
      if (!p) return sum;
      return sum + p.value * (p.unit === 'kg' || p.unit === '公斤' ? 1000 : 1);
    }, 0);

    const mainG = grams(recipe.ingredients);
    if (!mainG) return null;

    let saltG = 0;
    (recipe.seasonings || []).forEach((s) => {
      const name = s.name || '';
      const isSalt = /盐/.test(name);
      const isSoy = /生抽|老抽|酱油|鱼露|味噌|豆瓣/.test(name);
      if (!isSalt && !isSoy) return;
      const parts = parseQty(s.qty);
      const g = parts.find((x) => ['g', '克'].includes(x.unit));
      const spoon = parts.find((x) => SPOON_ML[x.unit]);
      let grammes = g ? g.value : (spoon ? spoon.value * SPOON_ML[spoon.unit] * (density(name) || 1) : 0);
      // 酱油大约 16% 是盐，味噌 12%，豆瓣 10%
      if (isSoy) grammes *= /味噌/.test(name) ? 0.12 : /豆瓣/.test(name) ? 0.1 : 0.16;
      saltG += grammes;
    });
    if (!saltG) return null;
    const pct = Math.round((saltG / mainG) * 1000) / 10;
    if (!isFinite(pct) || pct <= 0 || pct > 12) return null;
    return { pct, saltG: Math.round(saltG * 10) / 10, mainG: Math.round(mainG) };
  }

  // ------------------------------------------------------------------ //
  // 随手写的一行材料，怎么拆成 名字 / 用量 / 备注
  // ------------------------------------------------------------------ //

  const UNIT_WORDS = 'kg|公斤|g|克|ml|毫升|cc|L|升|汤匙|大勺|大匙|茶匙|小勺|小匙|勺|杯|碗|个|只|颗|瓣|根|支|片|块|条|张|把|节|枝|尾|棵|人份|份';

  /** 用量长什么样。注意中文数字必须紧跟单位才算数 ——
   *  不然「五花肉」的「五」会被当成 5，名字就散了。 */
  const LINE_NUMBER = '(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?|[½⅓⅔¼¾⅛]|[一二三四五六七八九十两半](?=\\s*(?:' + UNIT_WORDS + ')))';
  const LINE_QTY = new RegExp(LINE_NUMBER + '\\s*(?:' + UNIT_WORDS + ')?'
    + '(?:\\s*[-–~～至到]\\s*' + LINE_NUMBER + '\\s*(?:' + UNIT_WORDS + ')?)?');

  const VAGUE = /适量|少许|随意|按口味|酌量|一点点|一小把|若干/;

  /** 「五花肉 600g 三层带皮」「600g 五花肉」「盐 适量」都要拆得对。
   *  拆不动就整行当名字 —— 记菜的人不该为了迁就格式而改自己的写法。 */
  function splitLine(line) {
    const raw = String(line || '').trim().replace(/[，,]\s*$/, '');
    if (!raw) return null;

    // 明确用 | 分栏的，照旧尊重
    if (raw.includes('|')) {
      const parts = raw.split('|').map((x) => x.trim());
      if (parts.length === 2) {
        const parsed = splitLine(parts[0]);
        if (parsed && parsed.qty) return { ...parsed, note: [parsed.note, parts[1]].filter(Boolean).join('，') };
      }
      const [name, qty, note] = parts;
      return name ? { name, qty: qty || '', note: note || '' } : null;
    }

    const vague = raw.match(VAGUE);
    const m = raw.match(LINE_QTY);

    if (!m && !vague) return { name: raw, qty: '', note: '' };

    const hit = m && (!vague || m.index < vague.index) ? m : vague;
    const qty = hit[0].trim();
    let before = raw.slice(0, hit.index).trim().replace(/[，,、:：]$/, '');
    let after = raw.slice(hit.index + hit[0].length).trim().replace(/^[，,、:：]/, '').trim();

    // 用量写在最前面：「600g 五花肉，三层带皮」
    if (!before) {
      const parts = after.split(/[，,]/);
      return { name: (parts.shift() || '').trim(), qty, note: parts.join('，').trim() };
    }
    return { name: before, qty, note: after };
  }

  return {
    parseQty, scaleQty, scaleItems, sumQty, precise, density, readStep, splitLine,
    recipeTemps, saltPercent, SPOON_ML, HEAT_HINT,
  };
})();
