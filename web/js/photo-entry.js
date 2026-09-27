/* Photo-assisted entry stays a draft until the surrounding form is saved. */
const PhotoEntry = (() => {
  function markup(entity) {
    return `<section class="photo-entry" aria-label="照片与识别">
      <h3>拍一张，帮你记</h3>
      <p class="form-help">拍菜品、食材或包装，自动识别为可修改的草稿。原图始终保留，手绘不准确时可选回原图。</p>
      <p class="photo-readiness">${DB.state.mode !== 'server' ? '本机草稿 · 可保存照片，AI 功能需连接家里的服务'
        : `照片识别：${DB.state.config.photo_analysis_ready ? '已配置' : '未配置'} · 照片转手绘：${DB.state.config.photo_edit_ready ? '已配置' : '未配置'}`}</p>
      ${DB.state.mode === 'server' && (!DB.state.config.photo_analysis_ready || !DB.state.config.photo_edit_ready)
        ? '<p class="form-help">可先手动填写并保存原图。要启用 AI，请从页头 ⚙ 设置填写「照片识别」和「照片转手绘」，再回来编辑。</p>' : ''}
      <div class="btn-row">
        <button type="button" class="btn" data-photo-camera>拍照</button>
        <button type="button" class="btn btn-quiet" data-photo-album>从相册选择</button>
      </div>
      <input type="file" accept="image/*" capture="environment" data-photo-capture hidden>
      <input type="file" accept="image/*" data-photo-file hidden>
      <div class="photo-choices" hidden>
        <label><input type="radio" name="photo-choice" value="original" checked><img data-photo-original alt="原始照片"><span>使用原图</span></label>
        <label data-photo-drawing-choice hidden><input type="radio" name="photo-choice" value="illustration"><img data-photo-drawing alt="手绘候选图"><span>使用手绘图</span></label>
      </div>
      <p class="photo-status" role="status" aria-live="polite"></p>
      <ul class="photo-uncertainties" hidden></ul>
      <div class="btn-row photo-retry" hidden>
        <button type="button" class="btn btn-quiet" data-photo-analyze>重新识别</button>
        <button type="button" class="btn btn-quiet" data-photo-stylize>生成手绘</button>
        <button type="button" class="btn btn-quiet" data-photo-stop hidden>停止处理</button>
      </div>
      <p class="form-help">${DB.state.mode === 'server'
        ? '识别和手绘会把照片发送到设置中配置的 AI 服务。请核对识别结果；仅凭照片无法确认用量、做法和过敏原。'
        : '当前是本机草稿：可拍照保存原图；AI 识别和手绘需要连接家里的服务。'}</p>
    </section>`;
  }

  function bind(form, kind, entity, applyDraft) {
    const root = form.querySelector('.photo-entry');
    const q = (selector) => root.querySelector(selector);
    let original = null, illustration = null, blob = null, controller = null, revision = 0, preparing = false;
    let selected = entity.image && entity.image === entity.illustration_image ? 'illustration' : 'original';
    // An existing record is authoritative; photo recognition only fills its blanks.
    const baseline = new Map([...form.elements].filter((x) => x.name && (!entity.id || x.value === '')).map((x) => [x.name, x.value]));
    const status = (text) => { q('.photo-status').textContent = text; };
    const dirty = () => form.dispatchEvent(new Event('input'));
    const alive = (version) => root.isConnected && version === revision;
    const choices = () => {
      const origUrl = original || (entity.original_image ? DB.imgUrl(entity.original_image) : null);
      const drawingUrl = illustration || (!original && entity.illustration_image ? DB.imgUrl(entity.illustration_image) : null);
      q('.photo-choices').hidden = !origUrl;
      if (origUrl) q('[data-photo-original]').src = origUrl;
      q('[data-photo-drawing-choice]').hidden = !drawingUrl;
      if (drawingUrl) q('[data-photo-drawing]').src = drawingUrl;
      q(`input[value="${selected}"]`).checked = true;
      q('.photo-retry').hidden = !origUrl || DB.state.mode !== 'server';
    };
    const busy = (value) => {
      q('[data-photo-stop]').hidden = !value;
      q('[data-photo-analyze]').disabled = value;
      q('[data-photo-stylize]').disabled = value;
    };
    function cancel() {
      revision += 1;
      controller?.abort();
      controller = null;
      preparing = false;
      busy(false);
    }
    U.sheet.onClose(cancel);
    q('[data-photo-stop]').addEventListener('click', () => { cancel(); status('已停止等待，可以保留原图继续填写。'); });
    const warn = (warnings) => {
      q('.photo-uncertainties').innerHTML = warnings.map((x) => `<li>${U.esc(x)}</li>`).join('');
      q('.photo-uncertainties').hidden = !warnings.length;
    };
    async function process(analyze, draw) {
      if (DB.state.mode !== 'server') return;
      cancel();
      const version = revision;
      controller = new AbortController();
      const signal = controller.signal;
      busy(true);
      const messages = [];
      if (!blob && entity.original_image) {
        try {
          const response = await fetch(DB.imgUrl(entity.original_image), { signal });
          if (!response.ok) throw new Error('原图暂时无法读取');
          const prepared = await DB.preparePhoto(await response.blob());
          if (!alive(version)) return;
          let restoredDrawing = null;
          if (entity.illustration_image) {
            const response = await fetch(DB.imgUrl(entity.illustration_image), { signal });
            if (!response.ok) throw new Error('之前的手绘图暂时无法读取，请稍后重试');
            const preparedDrawing = await DB.preparePhoto(await response.blob());
            if (!alive(version)) return;
            restoredDrawing = preparedDrawing.dataUrl;
          }
          if (!alive(version)) return;
          blob = prepared.blob; original = prepared.dataUrl; illustration = restoredDrawing;
        } catch (err) { if (alive(version)) { status(err.message); busy(false); } return; }
      }
      if (!blob) { busy(false); return; }
      if (analyze) {
        if (!DB.state.config.photo_analysis_ready) messages.push('尚未配置照片识别模型，可以手动填写。');
        else try {
          status('正在识别照片，生成待确认草稿…');
          const out = await DB.photoAssist('analyze', kind, blob, signal);
          if (!alive(version)) return;
          applyDraft(out.draft, baseline);
          warn(['请确认名称与材料；看不清的字段已留空。', ...(out.uncertainties || [])]);
          dirty();
          messages.push('识别结果已填入未修改的字段，请核对。');
        } catch (err) { if (!alive(version)) return; messages.push('识别未完成：' + err.message); }
      }
      if (draw) {
        if (!DB.state.config.photo_edit_ready) messages.push('尚未配置照片转手绘服务，可先使用原图。');
        else try {
          status(messages.join(' ') + ' 正在参考原图绘制手绘候选图…');
          const out = await DB.photoAssist('stylize', kind, blob, signal);
          if (!alive(version)) return;
          illustration = out.image;
          choices(); dirty();
          messages.push('手绘候选图已生成。对比后选择使用原图或手绘图。');
        } catch (err) { if (!alive(version)) return; messages.push('手绘未完成：' + err.message + ' 原图仍可使用。'); }
      }
      if (alive(version)) { status(messages.join(' ')); busy(false); }
    }
    async function choose(file) {
      if (!file) return;
      cancel(); const version = revision;
      preparing = true;
      status('正在准备照片…');
      try {
        const prepared = await DB.preparePhoto(file);
        if (!alive(version)) return;
        preparing = false; blob = prepared.blob; original = prepared.dataUrl; illustration = null; selected = 'original';
        warn([]); choices(); dirty();
        if (DB.state.mode === 'server') await process(true, true);
        else status('照片已加入草稿，填写信息后即可保存。');
      } catch (err) { if (alive(version)) { preparing = false; status('照片无法打开：' + err.message); } }
    }
    for (const [button, input] of [['[data-photo-camera]', '[data-photo-capture]'], ['[data-photo-album]', '[data-photo-file]']]) {
      q(button).addEventListener('click', () => q(input).click());
      q(input).addEventListener('change', () => { const file = q(input).files[0]; q(input).value = ''; choose(file); });
    }
    q('[data-photo-analyze]').addEventListener('click', () => process(true, false));
    q('[data-photo-stylize]').addEventListener('click', () => process(false, true));
    root.querySelectorAll('[name="photo-choice"]').forEach((input) => input.addEventListener('change', () => {
      selected = input.value; dirty();
    }));
    // Existing records start with their current selected image. Only an explicit
    // radio change or a new upload should change it during an unrelated edit.
    let selectionChanged = false;
    root.querySelectorAll('[name="photo-choice"]').forEach((input) => input.addEventListener('change', () => { selectionChanged = true; }));
    choices();
    return {
      apply(payload) {
        if (preparing) throw new Error('照片还在准备中，请稍等后保存');
        cancel();
        if (original) payload.photo_assets = { original, illustration, selected };
        else if (entity.original_image && selectionChanged) {
          payload.image = selected === 'illustration' ? entity.illustration_image : entity.original_image;
          payload.image_provider = selected === 'illustration' ? 'photo-handdrawn' : 'photo';
        }
      },
    };
  }

  function fill(form, name, value, baseline) {
    const field = form.elements.namedItem(name);
    if (!baseline.has(name) || !field || value == null || value === '' || field.value !== baseline.get(name)) return;
    field.value = value;
    // Updating the baseline allows retrying recognition without replacing user edits.
    baseline.set(name, field.value);
  }
  return { markup, bind, fill };
})();
