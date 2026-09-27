/* Pure frontend regressions: TZ=Asia/Shanghai node scripts/check_logic.js */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
for (const name of ['util', 'units']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../web/js', name + '.js'), 'utf8'));
assert.deepEqual(Units.splitLine('面粉 1 1/2 杯'), { name: '面粉', qty: '1 1/2 杯', note: '' });
assert.deepEqual(Units.splitLine('鸡蛋 2-3 个'), { name: '鸡蛋', qty: '2-3 个', note: '' });
assert.deepEqual(Units.splitLine('小葱 3根 | 葱白葱绿分开'), { name: '小葱', qty: '3根', note: '葱白葱绿分开' });
assert.equal(Units.scaleQty('1 1/2 杯', 2), '3 杯');
assert.equal(Units.sumQty(['600g', '300g']), '900g');
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [2026, 8, 27, 0, 30])); }
};
assert.equal(U.today(), '2026-09-27');
assert.equal(U.daysAgo('2026-09-27'), 0);
assert.equal(U.daysAgo('2026-09-26'), 1);
global.Date = RealDate;
console.log('Frontend logic regressions passed.');

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../web/js/coursegen.js'), 'utf8'));
global.DB = { pantryItem: () => null, pantryByName: () => null };
const tax = {menu_templates:[{key:'test',slots:[{role:'热炒',base:1}]}]};
const dish = {id:'stove',title:'stove',course_role:['热炒'],tags:{station:['灶台','烤箱']}};
assert.equal(Course.plan({stations:[]},[dish],tax).picks.length,0);
assert.equal(Course.plan({stations:['灶台']},[dish],tax).picks.length,0);
assert.equal(Course.plan({stations:['灶台','烤箱']},[dish],tax).picks.length,1);
assert.equal(Course.plan({stations:[],locked:{'热炒':['stove']}},[dish],tax).picks.length,0);
console.log('Menu station constraints passed.');
