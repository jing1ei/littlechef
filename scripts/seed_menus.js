/* 生成示例菜单写进 seed/notebook.json（在 build_seed.py 之后跑） —— 让「存好的菜单」页面第一次打开就有东西看 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = {
  console, Date, Math,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { querySelector: () => ({}), querySelectorAll: () => [] },
  window: {}, location: { hash: '#/' },
  fetch: () => Promise.reject(new Error('offline')),
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['util.js', 'units.js', 'data.js', 'coursegen.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'web/js', f), 'utf8'), ctx, { filename: f });
}

const nbPath = path.join(root, 'seed/notebook.json');
const nb = JSON.parse(fs.readFileSync(nbPath, 'utf8'));
Object.assign(ctx, { TAX: nb.taxonomy, RECIPES: nb.recipes, PANTRY: nb.pantry });
vm.runInContext('DB.state.taxonomy = TAX; DB.state.recipes = RECIPES; DB.state.pantry = PANTRY;', ctx);

const WANT = [
  { key: 'jiayan', season: '秋', guests: 6, seed: 11, id: 'qiutian-de-jiayan',
    title: '中秋那顿家宴', date: '2026-09-06', serveAt: '18:00' },
  { key: 'teishoku', season: '春', guests: 4, seed: 4, id: 'chuntian-de-dingshi',
    title: '春天的一汁三菜', date: '2026-04-18', serveAt: '19:00' },
];

nb.menus = WANT.map((w) => {
  const out = vm.runInContext(
    `Course.plan({templateKey:${JSON.stringify(w.key)}, season:${JSON.stringify(w.season)}, guests:${w.guests}, seed:${w.seed}, serveAt:${JSON.stringify(w.serveAt)}}, DB.state.recipes, DB.state.taxonomy)`,
    ctx
  );
  console.log(`${w.title}：`, out.picks.map((p) => `${p.role}/${p.recipe.title}`).join('  '));
  return {
    id: w.id,
    title: w.title,
    date: w.date,
    template: out.template.key,
    template_name: out.template.name,
    guests: out.guests,
    season: out.season,
    serve_at: w.serveAt,
    settings: { diet: [], stations: [], effort: '正常', coherence: true, includeWishlist: false },
    dishes: out.picks.map((p) => ({ role: p.role, id: p.recipe.id, title: p.recipe.title })),
    notes: out.notes.map((n) => n.text),
  };
});

fs.writeFileSync(nbPath, JSON.stringify(nb, null, 2) + '\n');
console.log('写好了', nb.menus.length, '份菜单');
