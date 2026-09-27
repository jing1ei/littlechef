/* cookmode.js — 下厨模式，和一堆能同时跑的计时器。
 *
 * 手上是湿的、油的、粘的。菜谱页那种「材料在上面、做法在下面、来回滚 1000 像素」
 * 的看法，在灶台前是不成立的。所以这里只做一件事：一次只给一步，字大到
 * 站着能看清，材料随时能翻上来，火候和分钟数直接变成按得动的东西，
 * 屏幕不许自己黑掉。
 */

const Cook = (() => {
  // ------------------------------------------------------------ 计时器 --- //

  const Timers = (() => {
    const list = [];   // {id, label, dish, endAt, total, done}
    let audio = null;
    let tick = null;

    const beep = () => {
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        const now = audio.currentTime;
        [0, 0.28, 0.56].forEach((offset) => {
          const osc = audio.createOscillator();
          const gain = audio.createGain();
          osc.type = 'sine';
          osc.frequency.value = 784;
          gain.gain.setValueAtTime(0.0001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
          osc.connect(gain).connect(audio.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.24);
        });
      } catch (e) { /* 静音就静音，界面上还看得见 */ }
      if (navigator.vibrate) navigator.vibrate([220, 120, 220]);
    };

    const warm = () => {
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
      } catch (e) { /* 没声音也能用 */ }
    };

    function start(minutes, label, dish) {
      warm();
      const t = {
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        label: label || U.minutes(minutes),
        dish: dish || '',
        total: minutes * 60,
        endAt: Date.now() + minutes * 60000,
        done: false,
      };
      list.push(t);
      render();
      run();
      return t;
    }

    const stop = (id) => {
      const i = list.findIndex((t) => t.id === id);
      if (i >= 0) list.splice(i, 1);
      render();
    };

    const running = () => list.length;

    function run() {
      if (tick) return;
      tick = setInterval(() => {
        let ring = false;
        list.forEach((t) => {
          if (!t.done && Date.now() >= t.endAt) { t.done = true; ring = true; }
        });
        if (ring) beep();
        render();
        if (!list.length) { clearInterval(tick); tick = null; }
      }, 500);
    }

    const clock = (secs) => {
      const s = Math.max(0, Math.round(secs));
      const m = Math.floor(s / 60);
      return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };

    function render() {
      let bar = U.qs('#timer-bar');
      if (!list.length) { if (bar) bar.remove(); document.documentElement.style.setProperty('--timer-height', '0px'); return; }
      if (!bar) {
        bar = U.el('<div class="timer-bar fixed-layer" id="timer-bar"></div>');
        document.body.appendChild(bar);
        const observer = new ResizeObserver(() => {
          if (!bar.isConnected) { observer.disconnect(); return; }
          document.documentElement.style.setProperty('--timer-height', bar.getBoundingClientRect().height + 'px');
        });
        observer.observe(bar);
      }

      // Structural rebuild only when the set of timers or their done-flags changes.
      // Otherwise we just tick the countdown text and the progress bar width in-place,
      // so tapping the stop button while it's ticking doesn't miss the touch and the
      // browser doesn't rethread listeners twice a second.
      const signature = list.map((t) => `${t.id}:${t.done ? 1 : 0}`).join('|');
      if (bar.dataset.sig !== signature) {
        bar.dataset.sig = signature;
        bar.innerHTML = list.map((t) => {
          const left = (t.endAt - Date.now()) / 1000;
          const pct = Math.max(0, Math.min(100, (1 - left / t.total) * 100));
          return `<div class="timer ${t.done ? 'ding' : ''}" data-timer="${U.attr(t.id)}">
            <span class="bar" style="width:${t.done ? 100 : pct}%"></span>
            <span class="txt">
              <b class="txt-clock">${t.done ? '到点了' : clock(left)}</b>
              <i>${U.esc(t.dish ? t.dish + ' · ' : '')}${U.esc(t.label)}</i>
            </span>
            <button class="x" aria-label="停掉">${t.done ? '知道了' : '停'}</button>
          </div>`;
        }).join('');
        U.qsa('[data-timer] .x', bar).forEach((b) => b.addEventListener('click', (e) => {
          e.stopPropagation();
          stop(b.closest('[data-timer]').dataset.timer);
        }));
      } else {
        list.forEach((t) => {
          if (t.done) return;
          const node = bar.querySelector(`[data-timer="${CSS.escape(t.id)}"]`);
          if (!node) return;
          const left = (t.endAt - Date.now()) / 1000;
          const pct = Math.max(0, Math.min(100, (1 - left / t.total) * 100));
          const barEl = node.querySelector('.bar');
          if (barEl) barEl.style.width = `${pct}%`;
          const clockEl = node.querySelector('.txt-clock');
          if (clockEl) clockEl.textContent = clock(left);
        });
      }
    }

    return { start, stop, running, render };
  })();

  // ------------------------------------------------------------ 不黑屏 --- //

  let wake = null;

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator) {
        const acquired = await navigator.wakeLock.request('screen');
        if (!cur) { await acquired.release(); return; }
        wake = acquired;
        acquired.addEventListener('release', () => { if (wake === acquired) wake = null; });
      }
    } catch (e) { /* 浏览器不给就算了，不是错 */ }
  }

  function releaseAwake() {
    try { if (wake) wake.release(); } catch (e) { /* 无所谓 */ }
    wake = null;
  }

  // 浏览器把 tab 切走一次，wake lock 就被自动释放；切回来要重新申请，
  // 否则灶台边看着看着屏就黑了。
  function onVisibility() {
    if (document.visibilityState === 'visible' && document.body.classList.contains('cooking') && !wake) {
      keepAwake();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  // -------------------------------------------------------------- 状态 --- //

  let cur = null;    // {recipe, step, servings, checked:Set, doneSteps:Set}

  const factor = () => (cur.servings / (cur.recipe.servings || cur.servings || 4));

  const items = () => {
    const f = factor();
    return {
      ingredients: Units.scaleItems(cur.recipe.ingredients, f),
      seasonings: Units.scaleItems(cur.recipe.seasonings, f),
    };
  };

  // -------------------------------------------------------------- 界面 --- //

  function chips(stepText, tip) {
    const read = Units.readStep(stepText + ' ' + (tip || ''));
    const out = [];
    if (read.heat) {
      out.push(`<span class="ck-chip heat" title="${U.attr(read.heatHint)}">${U.esc(read.heat)}${
        read.heatHint ? `<i>${U.esc(read.heatHint)}</i>` : ''}</span>`);
    }
    read.temps.forEach((t) => out.push(`<span class="ck-chip temp">${U.esc(t.label)}</span>`));
    read.times.forEach((t) => out.push(
      `<button class="ck-chip time" data-start="${t.minutes}" data-label="${U.attr(t.label)}">
        ⏱ ${U.esc(t.label)} <i>按一下开始计时</i></button>`
    ));
    return out.length ? `<div class="ck-chips">${out.join('')}</div>` : '';
  }

  function paint() {
    const r = cur.recipe;
    const steps = r.steps || [];
    const s = steps[cur.step] || { text: '' };
    const { ingredients, seasonings } = items();
    const total = steps.length;
    const f = factor();

    const line = (i, kind, idx) => {
      const key = kind + idx;
      const on = cur.checked.has(key);
      const stock = DB.stockOf(i);
      return `<li role="checkbox" tabindex="0" aria-checked="${on}" class="${on ? 'on' : ''}" data-check="${U.attr(key)}">
        <span class="tick">${on ? '✓' : ''}</span>
        <span class="nm">${U.esc(i.name)}${stock && stock.missing ? '<em class="gone">家里没了</em>' : ''}</span>
        <span class="qt">${U.esc(i.qty || '')}${
          i.qty_original && i.qty !== i.qty_original ? `<i>原方 ${U.esc(i.qty_original)}</i>` : ''}</span>
      </li>`;
    };

    U.qs('#cook-body').innerHTML = `
      <div class="ck-top">
        <button class="ck-x" id="ck-close" aria-label="退出下厨模式">✕</button>
        <div class="ck-who">
          <b>${U.esc(r.title)}</b>
          <span>${cur.servings} 人份${Math.abs(f - 1) > 0.05 ? `（原方 ${r.servings || 4} 人，量已经折算过）` : ''}</span>
        </div>
        <div class="ck-serv">
          <button data-serv="-1" aria-label="少一人">−</button>
          <output>${cur.servings}</output>
          <button data-serv="1" aria-label="多一人">+</button>
        </div>
      </div>

      <details class="ck-mise" ${cur.step === 0 ? 'open' : ''}>
        <summary>材料 · 备齐了打个勾<span>${cur.checked.size}/${ingredients.length + seasonings.length}</span></summary>
        <ul class="ck-list">
          ${ingredients.map((i, idx) => line(i, 'i', idx)).join('')}
          ${seasonings.length ? '<li class="ck-sep">调味</li>' : ''}
          ${seasonings.map((i, idx) => line(i, 's', idx)).join('')}
        </ul>
      </details>

      <div class="ck-step">
        <div class="ck-count">第 ${cur.step + 1} 步 / 共 ${total} 步</div>
        <p class="ck-text">${U.esc(s.text)}</p>
        ${s.tip ? `<p class="ck-tip">${U.esc(s.tip)}</p>` : ''}
        ${chips(s.text, s.tip)}
      </div>

      <div class="ck-dots">${steps.map((_, i) => `<button class="${
        i === cur.step ? 'on' : ''} ${cur.doneSteps.has(i) ? 'did' : ''}" data-goto="${i}">${i + 1}</button>`).join('')}</div>

      <div class="ck-nav">
        <button class="ck-btn quiet" id="ck-prev" ${cur.step === 0 ? 'disabled' : ''}>上一步</button>
        ${cur.step < total - 1
          ? '<button class="ck-btn go" id="ck-next">这步做完了</button>'
          : '<button class="ck-btn go" id="ck-done">出锅，记一笔</button>'}
      </div>`;

    bind();
  }

  function bind() {
    const root = U.qs('#cook-body');
    U.qs('#ck-close', root).addEventListener('click', close);

    U.qsa('[data-serv]', root).forEach((b) => b.addEventListener('click', () => {
      cur.servings = Math.max(1, Math.min(30, cur.servings + Number(b.dataset.serv)));
      paint();
    }));

    // 打勾不重画整页：备料的时候一根手指连点十下，页面不该跟着跳
    U.qsa('[data-check]', root).forEach((li) => li.addEventListener('click', () => {
      const k = li.dataset.check;
      const on = !cur.checked.has(k);
      if (on) cur.checked.add(k); else cur.checked.delete(k);
      li.classList.toggle('on', on);
      li.setAttribute('aria-checked', String(on));
      U.qs('.tick', li).textContent = on ? '✓' : '';
      const n = U.qs('.ck-mise summary span', root);
      if (n) n.textContent = `${cur.checked.size}/${U.qsa('[data-check]', root).length}`;
    }));

    U.qsa('[data-check]', root).forEach((li) => li.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); li.click(); }
    }));

    U.qsa('[data-start]', root).forEach((b) => b.addEventListener('click', () => {
      Timers.start(Number(b.dataset.start), b.dataset.label, cur.recipe.title);
      U.toast('计时开始，到点会响');
    }));

    U.qsa('[data-goto]', root).forEach((b) => b.addEventListener('click', () => {
      cur.step = Number(b.dataset.goto);
      paint();
    }));

    const prev = U.qs('#ck-prev', root);
    if (prev) prev.addEventListener('click', () => { cur.step = Math.max(0, cur.step - 1); paint(); });

    const next = U.qs('#ck-next', root);
    if (next) next.addEventListener('click', () => {
      cur.doneSteps.add(cur.step);
      cur.step = Math.min((cur.recipe.steps || []).length - 1, cur.step + 1);
      paint();
      U.qs('#cook').scrollTop = 0;
    });

    const done = U.qs('#ck-done', root);
    if (done) done.addEventListener('click', () => {
      cur.doneSteps.add(cur.step);
      const r = cur.recipe;
      close();
      Editor.openLog(r, { cooked: true });
    });
  }

  // -------------------------------------------------------------- 开关 --- //

  function open(recipe, startServings) {
    if (!(recipe.steps || []).length) {
      U.toast('这道菜还没写做法，先补两步再进下厨模式');
      return;
    }
    cur = {
      recipe,
      step: 0,
      servings: startServings || recipe.servings || 4,
      checked: new Set(),
      doneSteps: new Set(),
    };
    let shell = U.qs('#cook');
    if (!shell) {
      shell = U.el('<div class="cook fixed-layer" id="cook"><div class="cook-body" id="cook-body"></div></div>');
      document.body.appendChild(shell);
    }
    shell.hidden = false;
    document.body.classList.add('cooking');
    paint();
    keepAwake();
    Timers.render();
    document.addEventListener('keydown', keys);
  }

  function close() {
    const shell = U.qs('#cook');
    if (shell) shell.hidden = true;
    document.body.classList.remove('cooking');
    document.removeEventListener('keydown', keys);
    releaseAwake();
    cur = null;
    if (Timers.running()) U.toast('计时器还在跑，到点会响');
  }

  function keys(e) {
    if (!cur || e.target.closest('a, input, textarea, select, button, [role=checkbox]')) return;
    if ([' ', 'ArrowRight', 'ArrowLeft'].includes(e.key)) e.preventDefault();
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' || e.key === ' ') {
      cur.doneSteps.add(cur.step);
      cur.step = Math.min((cur.recipe.steps || []).length - 1, cur.step + 1);
      paint();
    }
    if (e.key === 'ArrowLeft') { cur.step = Math.max(0, cur.step - 1); paint(); }
  }

  return { open, close, Timers };
})();
