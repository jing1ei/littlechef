/* settings.js — 设置抽屉。让家里的人不用敲命令行也能改。
 *
 * 只在连着 NAS 的时候能改（server 模式）。分享出去的静态站点里，
 * 这个按钮会弹一句解释，把人指回家里的入口。
 */

const Settings = (() => {
  // 分组和排序都在这里定：加字段就在 SCHEMA 里加，UI 会自动跟上。
  const GROUPS = [
    {
      title: '照片识别', hint: '使用支持图片输入的 Chat Completions 兼容模型；填写该服务的完整 /v1 或 /api/v3 地址。密钥留空时复用 OpenAI API Key。',
      keys: ['vision_base_url', 'vision_api_key', 'vision_model'],
    },
    {
      title: '照片转手绘', hint: '需要支持 /images/edits 的图像编辑服务，参考原图生成候选图。密钥留空时复用 OpenAI API Key。',
      keys: ['photo_edit_base_url', 'photo_edit_api_key', 'photo_edit_model'],
    },
    {
      title: '门牌',
      hint: '这本菜谱怎么叫，浏览器标签也跟着改。',
      keys: ['house_name', 'house_subtitle'],
    },
    {
      title: '谁能改',
      hint: '不填 PIN = 家里网络内谁都能改；只读适合投屏或对外分享。',
      keys: ['edit_pin', 'read_only'],
    },
    {
      title: '出图模型',
      hint: '选一个就够了，另外两组留空。选 none 会现画一张手绘占位图，不会开天窗。',
      keys: ['image_provider', 'image_size'],
    },
    {
      title: '火山方舟 / 豆包 Seedream',
      hint: '国内 NAS 最省事。控制台去 console.volcengine.com/ark 拿 API Key。',
      keys: ['ark_api_key', 'ark_image_model', 'ark_base_url'],
      when: (values) => ['ark', 'doubao'].includes(values.image_provider),
    },
    {
      title: 'OpenAI / 兼容中转',
      hint: '任何提供 /v1/images/generations 的服务都行。',
      keys: ['openai_api_key', 'openai_image_model', 'openai_base_url'],
      when: (values) => values.image_provider === 'openai',
    },
    {
      title: '本地 Stable Diffusion WebUI / Forge',
      hint: '需要 WebUI 用 --api 启动。完全在家里的机器上跑，不出门。',
      keys: ['sd_webui_url', 'sd_steps', 'sd_cfg', 'sd_sampler', 'sd_negative_prompt'],
      when: (values) => values.image_provider === 'sdwebui',
    },
  ];

  const LABEL = {
    vision_base_url: '照片识别服务地址', vision_api_key: '照片识别 API Key', vision_model: '视觉模型 ID',
    photo_edit_base_url: '手绘编辑服务地址', photo_edit_api_key: '手绘编辑 API Key', photo_edit_model: '图像编辑模型 ID',
    house_name: '门牌',
    house_subtitle: '副标题（拉丁文小字）',
    edit_pin: '编辑 PIN',
    read_only: '只读模式',
    image_provider: '出图提供方',
    image_size: '出图尺寸',
    ark_api_key: 'API Key',
    ark_image_model: '模型 ID',
    ark_base_url: 'Base URL（一般不改）',
    openai_api_key: 'API Key',
    openai_image_model: '模型 ID',
    openai_base_url: 'Base URL',
    sd_webui_url: 'WebUI 地址',
    sd_steps: 'steps',
    sd_cfg: 'cfg scale',
    sd_sampler: 'sampler',
    sd_negative_prompt: 'negative prompt',
  };

  const PROVIDER_LABEL = {
    none: 'none — 不接大模型，出手绘占位图',
    ark: 'ark / doubao — 火山方舟 · Seedream',
    openai: 'openai — OpenAI 或兼容中转',
    sdwebui: 'sdwebui — 本地 Stable Diffusion WebUI',
  };

  // secret 字段：如果 UI 里显示的还是原来那串圆点，就往后端发这个哨兵，
  // 表示"别动它"。清空就发空字符串。
  const SECRET_SENTINEL = '__unchanged__';

  function fieldHtml(spec) {
    const label = U.esc(LABEL[spec.key] || spec.key);
    const value = spec.value == null ? '' : spec.value;
    const src = spec.source === 'env'
      ? '<i class="src src-env" title="这个值是启动时从环境变量读的；下面改会写到 data/settings.json，覆盖它。">env</i>'
      : spec.source === 'file'
        ? '<i class="src src-file" title="改动会写进 data/settings.json，容器不用重启。">file</i>'
        : '';
    if (spec.kind === 'bool') {
      const on = spec.value === true;
      return `<label class="setting-row">
        <span class="setting-name">${label} ${src}</span>
        <span class="setting-toggle">
          <input type="checkbox" name="${U.attr(spec.key)}" ${on ? 'checked' : ''}>
          <span>${on ? '开着' : '关着'}</span>
        </span>
      </label>`;
    }
    if (spec.kind === 'enum') {
      const opts = (spec.options || []).map((v) => `
        <option value="${U.attr(v)}" ${v === value ? 'selected' : ''}>${U.esc(PROVIDER_LABEL[v] || v)}</option>`
      ).join('');
      return `<label class="setting-row">
        <span class="setting-name">${label} ${src}</span>
        <select class="field" name="${U.attr(spec.key)}">${opts}</select>
      </label>`;
    }
    if (spec.kind === 'secret') {
      const shown = spec.has_value ? '••••••••' : '';
      return `<label class="setting-row">
        <span class="setting-name">${label} ${src}
          ${spec.has_value ? '<i class="src src-set">已配置</i>' : ''}
        </span>
        <div class="setting-secret">
          <input class="field" type="password" name="${U.attr(spec.key)}"
                 data-secret="1" data-mask="${U.attr(shown)}" value="${U.attr(shown)}"
                 autocomplete="new-password" placeholder="${spec.has_value ? '留着不动就别改' : '粘 API Key'}">
          ${spec.has_value ? `<button type="button" class="btn btn-quiet danger" data-clear="${U.attr(spec.key)}">清掉</button>` : ''}
        </div>
      </label>`;
    }
    const type = spec.kind === 'int' || spec.kind === 'float' ? 'number' : 'text';
    const step = spec.kind === 'float' ? ' step="0.1"' : '';
    const long = spec.key === 'sd_negative_prompt';
    if (long) {
      return `<label class="setting-row">
        <span class="setting-name">${label} ${src}</span>
        <textarea class="field" name="${U.attr(spec.key)}" rows="2">${U.esc(value)}</textarea>
      </label>`;
    }
    return `<label class="setting-row">
      <span class="setting-name">${label} ${src}</span>
      <input class="field" type="${type}"${step} name="${U.attr(spec.key)}" value="${U.attr(value)}">
    </label>`;
  }

  function currentValues(schema) {
    // 用于 group.when(...) 判断哪几组要露出来
    const out = {};
    Object.keys(schema).forEach((k) => { out[k] = schema[k].value; });
    return out;
  }

  function render(schema) {
    const values = currentValues(schema);
    const groups = GROUPS;
    const groupsHtml = groups.map((g) => {
      const rows = g.keys
        .filter((k) => schema[k])
        .map((k) => fieldHtml(schema[k]))
        .join('');
      return `<section class="setting-group" data-setting-group="${GROUPS.indexOf(g)}" ${g.when && !g.when(values) ? 'hidden' : ''}>
        <header><h3>${U.esc(g.title)}</h3>${g.hint ? `<p>${U.esc(g.hint)}</p>` : ''}</header>
        <div class="setting-rows">${rows}</div>
      </section>`;
    }).join('');

    if (!U.sheet.open(`
      <h2>设置</h2>
      <div class="sub">保存后立即生效。切换插画服务时，已填写的内容会保留。</div>
      <form id="settings-form" class="settings-form">
        ${groupsHtml}
        <div class="btn-row" style="margin-top:22px">
          <button type="submit" class="btn btn-ink">保存</button>
          <button type="button" class="btn btn-quiet" id="settings-cancel">算了</button>
        </div>
      </form>`)) return;

    const root = U.qs('#sheet-body');
    const form = U.qs('#settings-form', root);
    U.qs('#settings-cancel', root).addEventListener('click', () => U.sheet.close());

    let dirty = false;
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('change', () => { dirty = true; });
    U.sheet.guard(() => !dirty || confirm('设置还没保存，确定放弃修改？'));
    const provider = form.querySelector('[name="image_provider"]');
    if (provider) provider.addEventListener('change', () => {
      U.qsa('[data-setting-group]', form).forEach((section) => {
        const group = GROUPS[Number(section.dataset.settingGroup)];
        section.hidden = !!group.when && !group.when({ image_provider: provider.value });
      });
    });
    U.qsa('input[type="checkbox"]', form).forEach((input) => input.addEventListener('change', () => {
      input.nextElementSibling.textContent = input.checked ? '开着' : '关着';
    }));

    // 「清掉」按钮：把 secret 字段清空，同时清掉后端的存储
    U.qsa('[data-clear]', root).forEach((btn) => btn.addEventListener('click', () => {
      const key = btn.dataset.clear;
      const input = form.querySelector(`[name="${CSS.escape(key)}"]`);
      if (input) {
        input.value = '';
        input.dataset.mask = '';
        input.dataset.cleared = '1';
      }
      dirty = true;
      btn.disabled = true;
      btn.textContent = '已清（保存后生效）';
    }));

    U.submit(form, async (e) => {
      e.preventDefault();
      const patch = collect(form, schema);
      try {
        const out = await DB.saveSettings(patch);
        U.sheet.close(true);
        applyLive(out);
        if (out && out.changed && out.changed.length) {
          U.toast(`保存好了（改了 ${out.changed.length} 项，已生效）`);
        } else {
          U.toast('没有需要改的');
        }
      } catch (err) {
        U.toast('没存上：' + err.message);
      }
    });
  }

  function collect(form, schema) {
    const fd = new FormData(form);
    const out = {};
    Object.keys(schema).forEach((key) => {
      const spec = schema[key];
      const el = form.querySelector(`[name="${CSS.escape(key)}"]`);
      if (!el) return;
      if (spec.kind === 'bool') {
        out[key] = el.checked;
        return;
      }
      const raw = (fd.get(key) || '').toString();
      if (spec.kind === 'secret') {
        if (el.dataset.cleared === '1') { out[key] = ''; return; }
        // 未修改的密钥保持原状。
        if (raw === el.dataset.mask) {
          out[key] = SECRET_SENTINEL;
          return;
        }
        out[key] = raw;
        return;
      }
      out[key] = raw;
    });
    return out;
  }

  function applyLive(out) {
    if (!out || !out.config) return;
    const cfg = out.config;
    DB.state.config = Object.assign({}, DB.state.config, cfg);
    DB.state.readOnly = !!cfg.read_only;
    const houseName = U.qs('[data-house-name]');
    const houseSub = U.qs('[data-house-sub]');
    if (houseName) houseName.textContent = cfg.house_name || 'littlechef';
    if (houseSub) houseSub.textContent = cfg.house_subtitle || '家庭菜谱';
    document.title = `${cfg.house_name || 'littlechef'} · ${cfg.house_subtitle || '家庭菜谱'}`;
    App.render();
  }

  async function open() {
    if (DB.state.mode !== 'server') {
      U.toast('设置只有在家里那台 NAS 上才能改；这里是只带一份底本的分享版');
      return;
    }
    try {
      const payload = await DB.getSettings();
      if (!payload) throw new Error('拿不到设置');
      render(payload.settings);
    } catch (err) {
      U.toast('打不开设置：' + err.message);
    }
  }

  return { open };
})();
