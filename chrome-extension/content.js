// Generated from douyin-live-auto.user.js v2.2.
(function () {
  'use strict';
  if (document.getElementById('__douyin_panel')) return;
  const KEY = '__douyin_live_auto_cfg_v2';
  const POS_KEY = '__douyin_live_auto_position_v1';
  const LOG_KEY = '__douyin_live_auto_log_v1';
  const LOCK = '__douyin_live_auto_executor_v1'; // 同源直播页共享，宁可少运行，避免重复发送
  const DANGER = /删除|移除|下架|撤下|取消关联|确认删除/;
  const DEFAULTS = {
    products: [],
    order: 'seq', explainMins: 3, commentMins: 5, jitter: 10,
    comments: [],
    explainOn: true, commentOn: true, pinOn: false, pinMins: 5, nativeRepliesOn: true,
    autoRecoverOn: true, recoverMins: 1,
  };
  const number = (value, fallback, min, max) => {
    const n = Number.parseFloat(value);
    return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
  };
  function normalize(raw = {}) {
    const c = { ...DEFAULTS, ...raw };
    c.products = (Array.isArray(c.products) ? c.products : DEFAULTS.products)
      .filter(p => p && /^\d+$/.test(String(p.id)))
      .map((p, i) => ({ id: String(p.id), seq: number(p.seq, i + 1, 1, 9999), name: String(p.name || p.label || p.id), price: String(p.price || '') }))
      .filter((p, i, all) => all.findIndex(x => x.id === p.id) === i);
    c.comments = (Array.isArray(c.comments) ? c.comments : DEFAULTS.comments).map(String).map(s => s.trim()).filter(Boolean);
    c.explainMins = number(c.explainMins, 3, 0.5, 1440);
    c.commentMins = number(c.commentMins, 5, 0.5, 1440);
    c.pinMins = number(c.pinMins, 5, 0.5, 1440);
    c.pinOn = c.pinOn === true;
    c.nativeRepliesOn = true;
    c.autoRecoverOn = c.autoRecoverOn !== false;
    c.recoverMins = number(c.recoverMins, 1, 0.5, 30);
    c.jitter = number(c.jitter, 10, 0, 50);
    c.order = c.order === 'random' ? 'random' : 'seq';
    c.explainOn = c.explainOn !== false; c.commentOn = c.commentOn !== false;
    return c;
  }
  let CFG;
  try { CFG = normalize(JSON.parse(localStorage.getItem(KEY) || '{}') || {}); }
  catch { CFG = normalize(); }
  const makeJob = () => ({ timer: null, due: 0, controller: null, failures: 0, blocked: false,
    reason: '', waiting: '', started: 0, generation: 0, submitted: false,
    recovery: 'manual', recoverAt: 0, recoverAttempts: 0, probeKey: '', probeSince: 0, pending: null, skipText: '' });
  const S = { on: false, phase: 'idle', run: 0, idx: 0, lastP: null, lastC: null, baseCount: null,
    current: '—', lastPin: null, account: '', editRevision: 0, commentIdx: 0, inventoryKnown: false, inventoryComplete: false,
    inventoryAt: 0, inventoryIssue: '', missingProducts: [], nextScanAt: 0, dirtyAt: 0,
    log: [], operations: new Set(), release: null, jobs: { explain: makeJob(), comment: makeJob(), pin: makeJob() } };
  const KINDS = ['explain', 'comment', 'pin'];
  const LABELS = { explain: '讲解', comment: '评论', pin: '置顶' };
  const deadlines = new WeakMap();
  const abortError = () => new DOMException('操作已取消', 'AbortError');
  function check(signal) {
    if (signal?.aborted) throw abortError();
    if (signal && Date.now() > (deadlines.get(signal) || Infinity)) throw new DOMException('任务等待超时，本轮取消', 'TimeoutError');
  }
  function sleep(ms, signal) {
    check(signal);
    return new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  const jitterMs = mins => mins * 60000 * (1 + (Math.random() * 2 - 1) * CFG.jitter / 100);
  const jobDelay = kind => kind === 'pin' ? CFG.pinMins * 60000 : jitterMs(CFG[kind + 'Mins']);
  const log = m => { S.log.push(new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' ' + m);
    if (S.log.length > 100) S.log.shift(); renderLog();
    try { localStorage.setItem(LOG_KEY, JSON.stringify(S.log)); } catch {} };
  try { const saved = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    if (Array.isArray(saved)) S.log = saved.filter(s => typeof s === 'string').slice(-100).map(s => s.slice(0, 1000));
  } catch {}
  const rows = () => [...document.querySelectorAll('[data-rfd-draggable-id]')];
  const rowId = r => (r.getAttribute('aria-label') || '').split('--')[0];
  const rowSeq = r => +(r.querySelector('input') || {}).value || 0;
  const rowName = r => (r.innerText.split('\n').find(l => l.trim().length > 10) || '').trim().slice(0, 60);
  const rowPrice = r => (r.innerText.match(/¥\s*([\d.]+)/) || [])[1] || '';
  const totalCount = () => { const m = document.body.innerText.match(/全部\((\d+)\)/); return m ? +m[1] : null; };
  function scroller() {
    let e = rows()[0]?.parentElement;
    while (e && e !== document.body) {
      if (/^(auto|scroll)$/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight) return e;
      e = e.parentElement;
    }
    return null;
  }
  // 查找、自动扫描和手动刷新共用队列，防止交叉滚动及还原错位。
  let listQueue = Promise.resolve();
  function withList(task, signal) {
    const work = listQueue.then(async () => {
      check(signal);
      const sc = scroller(), keep = sc?.scrollTop;
      try { return await task(sc); }
      finally { if (sc?.isConnected) sc.scrollTop = keep; }
    });
    listQueue = work.catch(() => {});
    return work;
  }
  async function findRow(test, sc, signal) {
    check(signal);
    let r = rows().find(test); if (r) return r;
    if (!sc) return null;
    // 固定本轮范围并限时，列表加载异常时不无限扫描。
    const end = sc.scrollHeight, deadline = Date.now() + 15000;
    for (let y = 0; y <= end && Date.now() < deadline; y += Math.max(150, sc.clientHeight - 100)) {
      check(signal); sc.scrollTop = y; await sleep(350, signal);
      r = rows().find(test); if (r) return r;
    }
    return null;
  }
  function liveEnded() {
    return !rows().length && !document.querySelector('textarea[placeholder*="Enter键发送"]') &&
      /未开播|直播已结束/.test(document.body.innerText);
  }
  function guard() {
    if (!location.pathname.startsWith('/livesite/live/current')) { stop('已离开直播页'); return false; }
    if (liveEnded()) { stop('直播未开始或已结束'); return false; }
    const account = document.querySelector('[class*="panel-profile-name-"]')?.textContent.trim();
    if (S.account && account && account !== S.account) { stop('账号已切换，请重新确认设置'); return false; }
    const dialogs = [...document.querySelectorAll('[role=dialog],[class*=modal-wrap],[class*=popconfirm],[class*=Popconfirm],[class*=popover]')]
      .filter(d => d.offsetParent !== null && !d.closest('#__douyin_panel'));
    const bad = dialogs.find(d => DANGER.test(d.innerText || ''));
    if (bad) { stop('检测到危险弹窗「' + bad.innerText.slice(0, 20) + '」'); return false; }
    return true;
  }
  function requireActive(signal) {
    check(signal);
    if (!S.on || !guard()) throw abortError();
  }
  async function until(test, signal, timeout = 3000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { check(signal); if (test()) return true; await sleep(150, signal); }
    check(signal); return !!test();
  }
  function pickNext() {
    const products = S.inventoryKnown && S.inventoryComplete ? CFG.products.filter(p => ALL.some(a => a.id === p.id)) : CFG.products;
    const n = products.length; if (!n) return null;
    if (CFG.order === 'random' && n > 1) {
      const options = products.filter(p => p.id !== S.lastP);
      return options[Math.floor(Math.random() * options.length)];
    }
    return products[S.idx++ % n];
  }
  function failed(kind, message) {
    const job = S.jobs[kind]; job.failures++;
    log('⚠ ' + message + '（连续 ' + job.failures + ' 次）');
    if (job.failures >= 3 && !job.blocked) blockJob(kind, '连续失败：' + message, 'retry');
  }
  function blockJob(kind, reason, recovery = 'manual') {
    const job = S.jobs[kind]; job.blocked = true; job.reason = reason; job.waiting = '';
    job.recovery = recovery; job.probeKey = ''; job.probeSince = 0;
    job.recoverAt = Date.now() + CFG.recoverMins * 60000 * [1, 2, 5][Math.min(job.recoverAttempts, 2)];
    clearTimeout(job.timer); job.timer = null; job.due = 0;
    log('⚠ ' + LABELS[kind] + '已暂停：' + reason + (CFG.autoRecoverOn && recovery !== 'manual' ? '；等待自动检查恢复' : '；检查后点「恢复' + LABELS[kind] + '」'));
  }
  function resumeJob(kind) {
    const job = S.jobs[kind];
    if (!CFG[kind + 'On']) { log('先启用' + LABELS[kind] + '并保存'); return; }
    if (kind === 'comment') {
      const ta = document.querySelector('textarea[placeholder*="Enter键发送"]');
      if (ta?.value.trim() || document.activeElement === ta) { log('评论框仍被占用，请先发送或清空草稿，再恢复评论'); return; }
    }
    if (job.controller) { log(LABELS[kind] + '仍在处理中，请稍后恢复'); return; }
    job.blocked = false; job.reason = ''; job.waiting = ''; job.failures = 0;
    job.recoverAttempts = 0; job.recoverAt = 0; job.pending = null; job.skipText = ''; job.submitted = false;
    if (S.on) schedule(kind, jobDelay(kind));
    log(LABELS[kind] + '已恢复' + (S.on ? '，从完整间隔重新计时' : '，点开始后运行')); renderHead();
  }
  function recoveryProbe(kind) {
    if (navigator.onLine === false) return { ready: false, key: 'offline' };
    const job = S.jobs[kind];
    if (kind === 'explain') {
      const visible = rows();
      const available = CFG.products.filter(p => {
        const row = visible.find(r => rowId(r) === p.id);
        if (row) return /^(讲解|取消讲解)$/.test(row.querySelector('[class*=talking-btn]')?.innerText.trim() || '');
        // 虚拟列表中未显示的商品由完整货架确认，恢复后仍通过正常查找核验按钮。
        return visible.length && S.inventoryComplete && ALL.some(a => a.id === p.id);
      });
      return { ready: !!available.length, key: available.map(p => p.id).join(',') };
    }
    if (kind === 'comment') {
      const ta = document.querySelector('textarea[placeholder*="Enter键发送"]');
      const wrap = ta && (ta.closest('[class*="text-area"]') || ta.parentElement?.parentElement);
      const button = wrap && [...wrap.querySelectorAll('div,span,button')].find(e => !e.children.length && e.textContent.trim() === '发送');
      const pending = job.pending;
      const owned = !!pending && ta === pending.element && ta.value === pending.text && S.editRevision === pending.editRevision;
      const ready = !!ta && !!button && document.activeElement !== ta && (!ta.value.trim() || (job.recovery === 'submitted' && owned)) && CFG.comments.some(c => c.length <= (ta.maxLength > 0 ? ta.maxLength : Infinity));
      return { ready, key: ta ? 'comment:' + ta.value + ':' + (document.activeElement === ta) + ':' + S.editRevision : 'missing', clearDraft: owned && !!ta?.value.trim() };
    }
    const current = pinnedState();
    const account = document.querySelector('[class*="panel-profile-name-"]')?.textContent.trim();
    return { ready: !!account && !!current && Number.isFinite(current.count), key: JSON.stringify([account, current]),
      confirmedPin: !!job.pending && current?.count > 0 && current.text === job.pending.text };
  }
  function autoResume(kind, probe) {
    const job = S.jobs[kind];
    if (kind === 'comment' && probe.clearDraft) {
      const pending = job.pending, ta = pending?.element;
      if (!ta?.isConnected || ta.value !== pending.text || document.activeElement === ta || S.editRevision !== pending.editRevision) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      log('自动恢复评论：已放弃本轮结果不明的脚本草稿，本轮不补发');
    }
    if (kind === 'pin' && job.pending) {
      if (probe.confirmedPin) { S.lastPin = job.pending.text; job.skipText = ''; log('置顶延迟结果已确认'); }
      else { job.skipText = job.pending.text; log('置顶状态已稳定，保留当前置顶；本次结果不明的话术不再重试'); }
    }
    job.recoverAttempts++; job.blocked = false; job.reason = ''; job.waiting = ''; job.failures = 0;
    job.pending = null; job.submitted = false; job.recoverAt = 0; job.probeKey = ''; job.probeSince = 0;
    schedule(kind, jobDelay(kind));
    log('↻ 自动恢复' + LABELS[kind] + '（第 ' + job.recoverAttempts + ' 次），等待完整间隔后继续');
  }
  function recoverJobs(now) {
    if (!S.on || !CFG.autoRecoverOn || S.operations.size || !guard()) return;
    const ready = [];
    for (const kind of KINDS) {
      const job = S.jobs[kind];
      if (!CFG[kind + 'On'] || !job.blocked || job.recovery === 'manual' || job.controller || now < job.recoverAt) continue;
      const probe = recoveryProbe(kind);
      if (!probe.ready) { job.probeKey = ''; job.probeSince = 0; job.recoverAt = now + (job.recoverAttempts >= 3 ? 300000 : CFG.recoverMins * 60000); continue; }
      if (job.probeKey !== probe.key || !job.probeSince) { job.probeKey = probe.key; job.probeSince = now || 1; continue; }
      if (now - job.probeSince >= 15000) ready.push([kind, probe]);
    }
    if (ready.length >= 2) {
      // 保留浏览器锁、配置和已提交记录，只重建任务调度；不刷新页面或回放旧操作。
      KINDS.forEach(cancelJob);
      log('↻ 多项功能恢复就绪，自动重建助手调度');
      for (const kind of KINDS) if (!S.jobs[kind].blocked) schedule(kind, jobDelay(kind));
    }
    for (const [kind] of ready) { const probe = recoveryProbe(kind); if (probe.ready) autoResume(kind, probe); }
  }
  async function explainTick(signal) {
    requireActive(signal);
    const p = pickNext(); if (!p) { blockJob('explain', '当前货架没有可用的已选商品，等待商品同步', 'retry'); return; }
    await withList(async sc => {
      const r = await findRow(x => rowId(x) === p.id, sc, signal);
      requireActive(signal);
      if (!r) { S.dirtyAt = Date.now() || 1; failed('explain', '没找到 ' + p.seq + '号商品，已安排重新同步'); return; }
      const b = r.querySelector('[class*=talking-btn]'), t = b?.innerText.trim();
      if (t === '取消讲解') { S.current = rowSeq(r) + '号 ' + p.name; S.lastP = p.id; S.jobs.explain.failures = 0; S.jobs.explain.recoverAttempts = 0; log('· ' + rowSeq(r) + '号已在讲解'); return; }
      if (t !== '讲解' || !b.isConnected) { failed('explain', '讲解按钮异常，本轮跳过'); return; }
      requireActive(signal); b.click();
      const ok = await until(() => {
        const current = rows().find(x => rowId(x) === p.id);
        return current?.querySelector('[class*=talking-btn]')?.innerText.trim() === '取消讲解';
      }, signal);
      requireActive(signal);
      if (ok) { S.current = rowSeq(r) + '号 ' + p.name; S.lastP = p.id; S.jobs.explain.failures = 0; S.jobs.explain.recoverAttempts = 0; log('▶ 已确认讲解 ' + rowSeq(r) + '号 ' + p.name); }
      else failed('explain', '讲解结果未确认，本轮不重试');
    }, signal);
  }
  const quickReplyPanels = () => [...document.querySelectorAll('[class*="quick-reply-"]')].filter(e => visible(e) && textOf(e).startsWith('快捷回复推荐'));
  async function closeQuickReplies(ta, revision, signal, activeRequired = true) {
    if (!quickReplyPanels().length) return true;
    if (S.editRevision !== revision) return false;
    const active = document.activeElement;
    if (active && active !== ta && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return false;
    const targets = [...document.querySelectorAll('[class*="header-"] > div')]
      .filter(e => visible(e) && textOf(e) === '直播数据' && !e.children.length && !e.closest('button,a,[role=button]'));
    if (targets.length !== 1) return false;
    if (activeRequired) requireActive(signal); else check(signal);
    // 精确静态标题已经现场验证，不点击任意坐标或操作按钮。
    if (document.activeElement === ta) ta.blur();
    // 原生条目会异步更新文本和焦点；先让失焦状态提交，避免旧渲染再次展开弹层。
    await sleep(150, signal);
    if (S.editRevision !== revision || !targets[0].isConnected) return false;
    const settledActive = document.activeElement;
    if (settledActive && settledActive !== ta && /^(INPUT|TEXTAREA|SELECT)$/.test(settledActive.tagName)) return false;
    if (activeRequired) requireActive(signal); else check(signal);
    const target = targets[0], oldTabIndex = target.getAttribute('tabindex');
    target.setAttribute?.('tabindex', '-1'); target.focus?.({ preventScroll: true });
    if (oldTabIndex == null) target.removeAttribute?.('tabindex'); else target.setAttribute?.('tabindex', oldTabIndex);
    if (typeof PointerEvent !== 'undefined') {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    }
    targets[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    targets[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    targets[0].click();
    return until(() => !quickReplyPanels().length, signal, 1500);
  }
  async function commentTick(signal) {
    requireActive(signal);
    if (quickReadController || blockingWindows().length) {
      S.jobs.comment.waiting='网页窗口或快捷回复配置处理中，评论暂缓';return;
    }
    const ta = document.querySelector('textarea[placeholder*="Enter键发送"]');
    const wrap = ta && (ta.closest('[class*="text-area"]') || ta.parentElement?.parentElement);
    const btn = wrap && [...wrap.querySelectorAll('div,span,button')].find(e => !e.children.length && e.textContent.trim() === '发送');
    if (!ta || !btn) { failed('comment', '没找到评论框或发送按钮'); return; }
    if (ta.value.trim() || document.activeElement === ta) {
      S.jobs.comment.waiting = ta.value.trim() ? '输入框有草稿，自动评论等待中' : '输入框正在编辑，自动评论等待中';
      log(S.jobs.comment.waiting); return;
    }
    S.jobs.comment.waiting = '';
    if (!CFG.comments.length) { log('评论列表为空，本轮跳过'); return; }
    const limit = ta.maxLength > 0 ? ta.maxLength : Infinity;
    const valid = CFG.comments.filter(c => c.length <= limit);
    if (!valid.length) { blockJob('comment', '预设话术均超过输入框 ' + limit + ' 字限制，请缩短话术'); return; }
    const options = valid.filter(c => c !== S.lastC);
    const pool = options.length ? options : valid;
    const text = valid[S.commentIdx++ % valid.length];
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    let clicked = false, confirmed = false, scriptFocus = false;
    const commentRevision = S.editRevision;
    try {
      S.jobs.comment.pending = { text, element: ta, editRevision: S.editRevision };
      requireActive(signal);
      {
        const active = document.activeElement;
        if (active && active !== ta && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) { log('其他输入框正在编辑，快捷回复本轮跳过'); return; }
        ta.focus(); scriptFocus = true;
        let matches = [];
        await until(() => {
          matches = quickReplyPanels().flatMap(p => [...p.querySelectorAll('[class*="quick-reply-list-"] > div')])
            .filter(e => visible(e) && textOf(e) === text);
          return matches.length > 0;
        }, signal, 2000);
        requireActive(signal);
        if (S.editRevision !== S.jobs.comment.pending.editRevision) return;
        if (matches.length !== 1) { log('页面同文快捷回复缺失或重复，本轮跳过：' + text); return; }
        matches[0].click();
        const filled = await until(() => !ta.isConnected || S.editRevision !== commentRevision || ta.value === text, signal, 2000);
        requireActive(signal);
        if (S.editRevision !== commentRevision || !ta.isConnected) return;
        if (!filled || ta.value !== text) {log('原生快捷回复填入结果不一致，本轮不发送');return;}
        if (!await closeQuickReplies(ta, S.jobs.comment.pending.editRevision, signal)) {
          blockJob('comment','快捷回复弹层未安全收起，本轮未发送，请人工处理后恢复');return;
        }
      }
      await sleep(400, signal);
      requireActive(signal);
      if (!ta.isConnected || !btn.isConnected || ta.value !== text || (!CFG.nativeRepliesOn && document.activeElement === ta) || S.editRevision !== S.jobs.comment.pending?.editRevision) { log('评论框状态已变化，本轮跳过'); return; }
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') { failed('comment', '发送按钮不可用'); return; }
      requireActive(signal); clicked = true; S.jobs.comment.submitted = true; btn.click(); S.lastC = text;
      const cleared = await until(() => {
        const current = document.querySelector('textarea[placeholder*="Enter键发送"]');
        return current?.isConnected && current.value === '';
      }, signal, 10000);
      // 有些页面先清空，再异步恢复失败的草稿，不能看到一次清空就宣告完成。
      if (cleared) await sleep(1000, signal);
      requireActive(signal);
      if (cleared && document.querySelector('textarea[placeholder*="Enter键发送"]')?.value === '') {
        const revision = S.jobs.comment.pending.editRevision;
        confirmed = true; S.jobs.comment.submitted = false; S.jobs.comment.failures = 0; S.jobs.comment.recoverAttempts = 0; S.jobs.comment.pending = null;
        log('💬 评论已提交（输入框持续清空，未核验服务端）');
        if (!await closeQuickReplies(ta, revision, signal)) blockJob('comment', '快捷回复弹层未安全收起，请人工处理后恢复评论');
      }
    } finally {
      if (clicked && !confirmed) blockJob('comment', '评论提交结果未确认，本轮不补发', 'submitted');
      if (scriptFocus && document.activeElement === ta && S.editRevision === commentRevision) ta.blur();
      // 只撤回脚本尚未发送且无人接手的草稿；已点击的内容留给用户判断。
      if (!clicked && ta.isConnected && ta.value === text && document.activeElement !== ta && S.editRevision === S.jobs.comment.pending?.editRevision) {
        setter.call(ta, ''); ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (!clicked) S.jobs.comment.pending = null;
      if (!clicked && scriptFocus && S.on && !signal.aborted && S.editRevision === commentRevision) {
        if (!await closeQuickReplies(ta, commentRevision, signal)) blockJob('comment', '快捷回复弹层未安全收起，请人工处理后恢复评论');
      }
    }
  }
  function pinnedState() {
    const wrap = document.querySelector('[class^="wrap-If9q"]');
    if (!wrap) return null;
    return { text: wrap.querySelector('[class^="comment-"]')?.textContent.trim() || '',
      count: Number.parseInt(wrap.querySelector('[class^="number-"]')?.textContent, 10),
      status: wrap.querySelector('[class^="status-"]')?.textContent.trim() || '' };
  }
  function pinCandidates(account, pinnedText) {
    const list = document.getElementById('comment_all_tab_list_container');
    const byText = new Map();
    for (const row of list?.querySelectorAll(':scope > [class^="item-"]') || []) {
      const name = row.querySelector('[class^="item-name-"]')?.textContent.trim().replace(/[：:]$/, '');
      const text = row.querySelector('[class^="item-content-"]')?.textContent.trim();
      if (name !== account || !CFG.comments.includes(text) || text === pinnedText) continue;
      // 核验上箭头图形，避免页面按钮顺序变化时点到回复或其他操作。
      const button = [...row.querySelectorAll('[class^="hover-button-"] > [class^="icon-"]')]
        .find(b => b.querySelector('svg[viewBox="0 0 12 12"] path[d^="M3.125.25"]'));
      if (button) byText.set(text, { row, button, text }); // 同话术只保留最新一条
    }
    return [...byText.values()];
  }
  async function pinTick(signal) {
    requireActive(signal);
    const account = document.querySelector('[class*="panel-profile-name-"]')?.textContent.trim();
    const before = pinnedState();
    if (!account || !before || !Number.isFinite(before.count)) { failed('pin', '未识别本账号或置顶区域，本轮跳过'); return; }
    const candidates = pinCandidates(account, before.text).filter(c => c.text !== S.jobs.pin.skipText);
    const different = candidates.filter(c => c.text !== S.lastPin);
    const pool = different.length ? different : candidates;
    if (!pool.length) { S.jobs.pin.failures = 0; log('置顶：暂无其他本账号预设评论，本轮跳过'); return; }
    const target = pool[Math.floor(Math.random() * pool.length)];
    requireActive(signal);
    if (!target.row.isConnected || !target.button.isConnected) { log('置顶候选已移出列表，本轮跳过'); return; }
    let confirmed = false, changed = false;
    try {
    S.jobs.pin.pending = { text: target.text, account };
    S.jobs.pin.submitted = true;
    target.button.click(); // 页面原生置顶操作，无须改写评论或发送新评论
    const ok = await until(() => {
      const current = pinnedState();
      if (current && current.text !== before.text && current.text !== target.text) { changed = true; return true; }
      return current && current.count > 0 && current.text === target.text;
    }, signal, 10000);
    requireActive(signal);
    if (ok && !changed) {
      confirmed = true; S.jobs.pin.submitted = false;
      S.lastPin = target.text; S.jobs.pin.failures = 0; S.jobs.pin.recoverAttempts = 0; S.jobs.pin.pending = null; S.jobs.pin.skipText = '';
      const status = pinnedState()?.status;
      log('📌 置顶区域已更新' + (status ? '（' + status + '）' : '') + '：' + target.text);
    }
    } finally { if (!confirmed) blockJob('pin', changed ? '置顶内容在操作期间变化，等待状态稳定' : '置顶结果未确认，本次不重试', 'submitted'); }
  }
  function cancelJob(kind) {
    const job = S.jobs[kind]; clearTimeout(job.timer); job.timer = null; job.due = 0;
    job.generation++;
    job.controller?.abort(); job.controller = null;
  }
  function schedule(kind, delay) {
    const job = S.jobs[kind];
    clearTimeout(job.timer); job.timer = null; job.due = 0;
    if (!S.on || !CFG[kind + 'On'] || job.blocked) return;
    const generation = ++job.generation;
    job.due = Date.now() + delay;
    job.timer = setTimeout(() => { if (generation === job.generation) launch(kind); }, delay);
  }
  function launch(kind) {
    const job = S.jobs[kind], run = S.run;
    if (!S.on || !CFG[kind + 'On'] || job.blocked || job.controller) return;
    job.timer = null; job.due = 0; job.started = Date.now(); job.submitted = false;
    if (navigator.onLine === false) { job.waiting = '网络已断开，等待下轮'; log(LABELS[kind] + '：' + job.waiting); schedule(kind, jobDelay(kind)); return; }
    job.waiting = '';
    const controller = new AbortController(); job.controller = controller;
    deadlines.set(controller.signal, Date.now() + 120000);
    const work = (async () => {
      try { await ({ explain: explainTick, comment: commentTick, pin: pinTick }[kind])(controller.signal); }
      catch (e) { if (e.name !== 'AbortError') failed(kind, '执行出错：' + e.message); }
      finally {
        if (S.on && run === S.run && job.controller === controller && !controller.signal.aborted) {
          job.controller = null; schedule(kind, jobDelay(kind));
        }
      }
    })();
    S.operations.add(work); work.finally(() => S.operations.delete(work));
  }
  async function start() {
    if (S.phase !== 'idle') return;
    if (liveEnded()) { log('直播未开始或已结束，未启动'); return; }
    if (CFG.explainOn && !CFG.products.length) { log('先勾选商品并保存'); return; }
    if (!KINDS.some(kind => CFG[kind + 'On'])) { log('先启用至少一项功能并保存'); return; }
    if (!navigator.locks?.request) { log('当前浏览器不支持单标签执行锁，未启动'); return; }
    const run = ++S.run; S.phase = 'starting'; renderHead();
    try {
      await navigator.locks.request(LOCK, { ifAvailable: true }, async lock => {
        if (run !== S.run || S.phase !== 'starting') return;
        if (!lock) { log('另一个抖音直播标签页正在运行，请先在那里停止'); return; }
        const released = new Promise(resolve => { S.release = resolve; });
        S.on = true; S.phase = 'running'; S.baseCount = totalCount();
        S.account = document.querySelector('[class*="panel-profile-name-"]')?.textContent.trim() || '';
        for (const kind of KINDS) { const job = S.jobs[kind]; job.failures = 0; job.blocked = false; job.reason = ''; job.waiting = ''; job.recoverAttempts = 0; job.recoverAt = 0; job.pending = null; job.skipText = ''; }
        const current = CFG.products.findIndex(p => rows().some(r => rowId(r) === p.id && r.querySelector('[class*=talking-btn]')?.innerText.trim() === '取消讲解'));
        S.idx = current >= 0 ? current + 1 : 0; S.lastP = current >= 0 ? CFG.products[current].id : null;
        log('▶ 已开始，当前标签页独占执行'); renderHead();
        schedule('explain', 0); schedule('comment', 5000);
        schedule('pin', jobDelay('pin')); // 首次也等待完整间隔，不在开始时立即改置顶
        await released;
        // 等待已取消的任务退出，再释放浏览器锁，防止旧任务干扰下一轮。
        await Promise.allSettled([...S.operations]);
      });
    } catch (e) { log('启动失败：' + e.message); }
    finally {
      if (run === S.run) { S.on = false; S.phase = 'idle'; S.release = null; renderHead(); }
    }
  }
  function stop(why = '手动') {
    if (S.phase === 'idle') return;
    S.on = false; S.phase = 'stopping';
    KINDS.forEach(cancelJob);
    S.release?.(); log('■ 已停止：' + why); renderHead();
  }
  function settingsSignature(c, kind) {
    if (kind === 'pin') return JSON.stringify([c.pinOn, c.pinMins, c.comments]);
    return JSON.stringify(kind === 'explain' ? [c.explainOn, c.explainMins, c.jitter, c.order, c.products] : [c.commentOn, c.commentMins, c.jitter, c.comments, c.nativeRepliesOn]);
  }
  function applyConfig(next) {
    const before = CFG; CFG = normalize(next);
    for (const kind of KINDS) {
      if (settingsSignature(before, kind) === settingsSignature(CFG, kind)) continue;
      cancelJob(kind);
      if (kind === 'explain') S.idx = 0;
      if (kind === 'comment') S.commentIdx = 0;
      S.jobs[kind].failures = 0;
      // 改设置不会解除结果不明的暂停，统一由恢复检查处理。
      if (S.on) schedule(kind, jobDelay(kind));
    }
    if (before.autoRecoverOn !== CFG.autoRecoverOn || before.recoverMins !== CFG.recoverMins) {
      for (const kind of KINDS) if (S.jobs[kind].blocked) {
        S.jobs[kind].recoverAt = Date.now() + CFG.recoverMins * 60000;
        S.jobs[kind].probeKey = ''; S.jobs[kind].probeSince = 0;
      }
    }
    renderHead();
  }
  const textOf = e => (e?.innerText || e?.textContent || '').trim();
  const visible = e => {
    if (!e?.isConnected || !e.getClientRects().length) return false;
    if (e.checkVisibility && !e.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return false;
    const style = getComputedStyle(e);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none' && !e.closest?.('[aria-hidden=true],[inert]');
  };
  const blockingWindows = () => [...document.querySelectorAll('[class*="modal-show"],[class*="drawer-dialog-show"]')].filter(visible);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;' }[c]));
  let ALL = [], scanController = null;
  const productNameKey = name => String(name || '').normalize('NFKC').replace(/[\s+·|]/g, '');
  const productMatchKey = p => p.price && Number.isFinite(Number(p.price)) && productNameKey(p.name) ? productNameKey(p.name) + '|' + Number(p.price) : '';
  function reconcileProducts(found) {
    const byId = new Map(found.map(p => [p.id, p])), replacements = new Map(), missing = [];
    const before = S.inventoryComplete ? CFG.products.filter(p => ALL.some(a => a.id === p.id)) : CFG.products;
    const nextId = before.length ? before[S.idx % before.length].id : null;
    const selected = new Map();
    for (const old of CFG.products) {
      let current = byId.get(old.id);
      if (!current) {
        const key = productMatchKey(old);
        const matches = key ? found.filter(p => productMatchKey(p) === key) : [];
        if (matches.length === 1) {
          current = matches[0]; replacements.set(old.id, current.id);
          log('商品换链已对应：' + old.seq + '号 → ' + current.seq + '号 ¥' + current.price + '（名称和价格唯一匹配）');
        } else missing.push(old);
      }
      selected.set(current?.id || old.id, current || old);
    }
    CFG.products = [...selected.values()];
    draftIds = new Set([...draftIds].map(id => replacements.get(id) || id));
    S.missingProducts = missing;
    if (S.lastP) {
      S.lastP = replacements.get(S.lastP) || S.lastP;
      const current = byId.get(S.lastP);
      if (current) S.current = current.seq + '号 ' + current.name;
      else { S.lastP = null; S.current = '上次讲解商品已不在当前货架'; }
    }
    const available = CFG.products.filter(p => byId.has(p.id));
    const nextIndex = available.findIndex(p => p.id === (replacements.get(nextId) || nextId));
    S.idx = nextIndex >= 0 ? nextIndex : 0;
    try { localStorage.setItem(KEY, JSON.stringify(CFG)); } catch { log('商品已同步，浏览器未能保存换链对应'); }
  }
  async function scanAll(signal) {
    return withList(async sc => {
      const seen = new Map(), initialCount = totalCount();
      const grab = () => rows().forEach(r => { const id = rowId(r); if (id) seen.set(id, { id, seq: rowSeq(r), name: rowName(r), price: rowPrice(r) }); });
      check(signal); grab();
      if (sc) {
        const end = sc.scrollHeight, deadline = Date.now() + 15000;
        for (let y = 0; y <= end && Date.now() < deadline; y += Math.max(150, sc.clientHeight - 100)) {
          check(signal); sc.scrollTop = y; await sleep(350, signal); grab();
        }
        check(signal); sc.scrollTop = 0; await sleep(350, signal); grab();
      }
      const found = [...seen.values()].sort((a, b) => a.seq - b.seq), count = totalCount();
      found.complete = count != null && count === initialCount && found.length === count &&
        new Set(found.map(p => p.seq)).size === count && found.every(p => p.seq > 0);
      return found;
    }, signal);
  }
  const panel = document.createElement('div'); panel.id = '__douyin_panel';
  panel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#16181d;color:#eee;font:12px/1.6 -apple-system,PingFang SC,sans-serif;border-radius:10px;width:340px;max-width:calc(100vw - 16px);box-shadow:0 6px 24px rgba(0,0,0,.35)';
  const inp = 'background:#2a2d34;color:#fff;border:1px solid #444;border-radius:4px;padding:1px 4px';
  panel.innerHTML = `
    <div id="__head" style="padding:8px 10px;display:flex;align-items:center;gap:6px;cursor:move;touch-action:none" title="拖动可移动面板">
      <b id="__st" style="flex:1"></b><small>v2.2</small>
      <button id="__go" style="padding:2px 12px;border:0;border-radius:6px;cursor:pointer;color:#fff"></button>
      <button id="__fold" aria-label="折叠面板" style="background:none;color:#aaa;border:0;cursor:pointer">▾</button>
    </div>
    <div id="__body" style="padding:0 10px 10px;max-height:70vh;overflow:auto">
      <div id="__progress" style="color:#b8c6ef;margin-bottom:6px;white-space:pre-line"></div>
      <div id="__health" style="color:#ffcf70;margin-bottom:6px;white-space:pre-line"></div>
      <div style="display:flex;gap:5px;margin-bottom:6px">${KINDS.map(kind => `<button id="__resume_${kind}" style="${inp};cursor:pointer">恢复${LABELS[kind]}</button>`).join('')}</div>
      <div style="border-top:1px solid #333;padding-top:6px"><label><input type="checkbox" id="__eon"> <b>轮换讲解</b></label></div>
      <div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="flex:1">弹哪些链接（勾选）</span>
        <button id="__scan" style="padding:1px 8px;border:0;border-radius:5px;background:#444;color:#fff;cursor:pointer">刷新商品列表</button></div>
      <div id="__pick" style="max-height:150px;overflow:auto;background:#1f2228;border-radius:6px;padding:4px 6px;font-size:11px"></div>
      <div id="__inventory" style="color:#aaa;font-size:11px;white-space:pre-line"></div>
      <div style="margin-top:4px">每个讲 <input id="__emin" type="number" min="0.5" max="1440" step="0.5" style="${inp};width:48px"> 分钟　顺序
        <select id="__order" style="${inp}"><option value="seq">按顺序</option><option value="random">随机</option></select></div>
      <div style="border-top:1px solid #333;padding-top:6px;margin-top:4px"><label><input type="checkbox" id="__con"> <b>快捷评论</b></label>
        每 <input id="__cmin" type="number" min="0.5" max="1440" step="0.5" style="${inp};width:48px"> 分钟发一条</div>
      <button id="__reply_read" style="${inp};cursor:pointer">读取网页快捷回复</button>
      <button id="__reply_none" style="${inp};cursor:pointer">全部取消勾选</button>
      <div id="__reply_count" style="color:#b8c6ef"></div>
      <div id="__reply_list" style="max-height:180px;overflow:auto;background:#1f2228;padding:4px;border-radius:5px"></div>
      <div style="color:#aaa;font-size:11px">只点选网页原有快捷回复；勾选5条、10条均可，按网页顺序循环。不复制粘贴；读取不会发送评论。</div>
      <div style="border-top:1px solid #333;padding-top:6px;margin-top:4px"><label><input type="checkbox" id="__pon"> <b>随机置顶评论</b></label>
        每 <input id="__pmin" aria-label="置顶间隔（分钟）" type="number" min="0.5" max="1440" step="0.5" style="${inp};width:48px"> 分钟置顶一条</div>
      <div style="color:#aaa;font-size:11px">仅选本账号已发送的上述话术；无候选则跳过，首次等待完整间隔。</div>
      <div>讲解/评论时间浮动 ±<input id="__jit" type="number" min="0" max="50" style="${inp};width:38px">%
        <button id="__save" style="padding:2px 10px;border:0;border-radius:6px;background:#3e63dd;color:#fff;cursor:pointer">保存设置</button></div>
      <div style="border-top:1px solid #333;margin-top:5px;padding-top:5px"><label><input type="checkbox" id="__auto"> 异常自动恢复</label>　等待 <input id="__recover" type="number" min="0.5" max="30" step="0.5" style="${inp};width:42px"> 分钟</div>
      <div style="color:#aaa;font-size:11px">逐步延长等待；不补发结果不明的旧操作。手动停止后保持停止。</div>
      <div id="__log" style="margin-top:6px;max-height:110px;overflow:auto;opacity:.85;font-size:11px;border-top:1px solid #333;padding-top:4px;white-space:pre-wrap;overflow-wrap:anywhere"></div>
    </div>`;
  const $ = s => panel.querySelector(s);
  let draftIds = new Set(CFG.products.map(p => p.id));
  let QUICK = [], quickReadController = null, draftReplies = new Set(CFG.comments);
  function captureReplies() {
    if (!QUICK.length) return;
    draftReplies = new Set([...panel.querySelectorAll('.__qr:checked')].map(e => QUICK[Number(e.dataset.index)]).filter(Boolean));
    $('#__reply_count').textContent = '已勾选 '+draftReplies.size+'／'+QUICK.length+' 条（按网页顺序）';
  }
  function renderReplies() {
    const pool=QUICK.length?QUICK:CFG.comments;
    $('#__reply_list').innerHTML=pool.map((text,i)=>`<label style="display:block;white-space:pre-wrap;border-bottom:1px solid #333;padding:3px"><input class="__qr" type="checkbox" data-index="${i}" ${draftReplies.has(text)?'checked':''}> ${esc(text)}</label>`).join('')||'暂无快捷回复，请点击读取';
    $('#__reply_count').textContent=QUICK.length?'已勾选 '+draftReplies.size+'／'+QUICK.length+' 条（按网页顺序）':'已保存 '+CFG.comments.length+' 条；请读取网页列表后勾选';
  }
  async function readQuickReplies() {
    if(quickReadController||S.jobs.comment.controller){log('其他流程正在处理，请稍后读取快捷回复');return;}
    const controller=new AbortController();quickReadController=controller;$('#__reply_read').disabled=true;
    const ta=document.querySelector('textarea[placeholder*="Enter键发送"]'),revision=S.editRevision;
    let focused=false;
    try{
      if(!ta||ta.value.trim()||document.activeElement===ta)throw new Error('评论框正在编辑，请先完成评论');
      if(blockingWindows().length)throw new Error('请先关闭网页弹窗，再读取快捷回复');
      captureReplies();ta.focus();focused=true;
      if(!await until(()=>quickReplyPanels().length===1,controller.signal,3000))throw new Error('网页快捷回复未展开');
      const values=quickReplyPanels().flatMap(p=>[...p.querySelectorAll('[class*="quick-reply-list-"] > div')]).filter(visible).map(textOf).filter(Boolean);
      if(!values.length)throw new Error('网页没有已设置的快捷回复');
      QUICK=[...new Set(values)];draftReplies=new Set([...draftReplies].filter(t=>QUICK.includes(t)));renderReplies();
      log('已读取 '+QUICK.length+' 条网页快捷回复，请自行勾选并保存');
    }catch(e){log('读取快捷回复失败：'+e.message);}
    finally{
      if(focused&&S.editRevision===revision){ta.blur();try{if(!await closeQuickReplies(ta,revision,controller.signal,false))log('快捷回复未收起，请点击评论区外收起弹层');}catch{}}
      quickReadController=null;$('#__reply_read').disabled=false;
    }
  }
  function captureDraft() { draftIds = new Set([...panel.querySelectorAll('.__pk:checked')].map(x => x.dataset.id)); }
  function productPool() {
    return (S.inventoryKnown ? ALL : CFG.products).slice().sort((a, b) => a.seq - b.seq);
  }
  function renderPick() {
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pool = productPool();
    $('#__pick').innerHTML = pool.length ? pool.map(p => `<label style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(p.name)}">
      <input type="checkbox" class="__pk" data-id="${esc(p.id)}" ${draftIds.has(p.id) ? 'checked' : ''}>
      <b>${esc(p.seq)}号</b> ${p.price ? '¥' + esc(p.price) + ' ' : ''}${esc(p.name)}</label>`).join('') : '暂无商品，请刷新列表';
  }
  function fill() {
    $('#__eon').checked = CFG.explainOn; $('#__con').checked = CFG.commentOn;
    $('#__pon').checked = CFG.pinOn; $('#__pmin').value = CFG.pinMins;
    $('#__order').value = CFG.order; $('#__emin').value = CFG.explainMins;
    $('#__cmin').value = CFG.commentMins; $('#__jit').value = CFG.jitter;
    $('#__auto').checked = CFG.autoRecoverOn; $('#__recover').value = CFG.recoverMins; renderPick();renderReplies();
  }
  function renderLog() { $('#__log').textContent = S.log.slice(-12).reverse().join('\n'); }
  function countdown(kind) {
    const job = S.jobs[kind];
    if (!CFG[kind + 'On']) return '已关闭';
    if (job.blocked) return '已暂停，请检查提示';
    if (!S.on) return '—';
    if (job.controller) return '处理中';
    const secs = Math.max(0, Math.ceil((job.due - Date.now()) / 1000));
    return Math.floor(secs / 60) + '分' + String(secs % 60).padStart(2, '0') + '秒';
  }
  function renderHead() {
    const status = { idle: '🔴未运行', starting: '🟡正在启动', running: '🟢运行中', stopping: '🟡正在停止' }[S.phase];
    const problems = KINDS.filter(kind => CFG[kind + 'On'] && (S.jobs[kind].blocked || S.jobs[kind].waiting));
    $('#__st').textContent = '直播助手 ' + (S.on && problems.length ? '🟠部分任务需处理' : status);
    $('#__health').textContent = problems.map(kind => {
      const job = S.jobs[kind];
      const recovery = S.on && CFG.autoRecoverOn && job.blocked && job.recovery !== 'manual' ? '；' + (Date.now() < job.recoverAt ? Math.ceil((job.recoverAt - Date.now()) / 1000) + '秒后自动检查' : '正在等待状态稳定') : '';
      return LABELS[kind] + '：' + (job.reason || job.waiting) + recovery;
    }).join('\n');
    $('#__inventory').textContent = S.inventoryIssue || (S.inventoryKnown ? '当前货架 ' + ALL.length + ' 个；每60秒检查，变化后重扫\n上次读取：' + new Date(S.inventoryAt).toLocaleTimeString('zh-CN', { hour12: false }) : '等待读取当前货架');
    if (S.missingProducts.length) $('#__inventory').textContent += '\n' + S.missingProducts.length + ' 个原选链接已失效或无法唯一对应，暂不讲解；请勾选当前商品保存。';
    $('#__go').textContent = S.phase === 'idle' ? '开始' : '停止';
    $('#__go').disabled = S.phase === 'stopping'; $('#__go').style.background = S.phase === 'idle' ? '#30a46c' : '#e5484d';
    $('#__progress').textContent = '最近确认讲解：' + S.current + '\n下次讲解：' + countdown('explain') + '　评论：' + countdown('comment') + '\n下次置顶：' + countdown('pin');
  }
  async function refreshProducts(manual = true) {
    if (scanController) return;
    if (manual === false && Date.now() < S.nextScanAt) return;
    S.nextScanAt = Date.now() + 15000;
    captureDraft(); const controller = new AbortController(); scanController = controller;
    const previous = JSON.stringify(ALL), previousIssue = S.inventoryIssue;
    $('#__scan').disabled = true; $('#__scan').textContent = '读取中…';
    try {
      const found = await scanAll(controller.signal); check(controller.signal);
      captureDraft(); // 扫描期间的勾选也要保留
      if (found.complete) {
        reconcileProducts(found);
        ALL = found; S.inventoryKnown = true; S.inventoryComplete = true; S.inventoryIssue = '';
      } else {
        if (!S.inventoryKnown) { ALL = found; S.inventoryKnown = true; }
        S.inventoryIssue = '本次读到 ' + found.length + '/' + (totalCount() ?? '?') + ' 个，等待完整扫描；保留上次确认列表';
      }
      S.inventoryAt = Date.now(); S.dirtyAt = 0; renderPick(); renderHead();
      if (manual !== false || (found.complete ? previous !== JSON.stringify(ALL) : previousIssue !== S.inventoryIssue))
        log('读取到 ' + found.length + ' 个商品' + (found.complete ? '，当前货架已同步' : '，扫描未完整，稍后再检查'));
    } catch (e) { if (e.name !== 'AbortError') log('读取商品失败：' + e.message); }
    finally { if (scanController === controller) scanController = null; $('#__scan').disabled = false; $('#__scan').textContent = '刷新商品列表'; }
  }
  $('#__go').onclick = () => { S.phase === 'idle' ? start() : stop('点了停止'); };
  $('#__fold').onclick = () => { const body = $('#__body'); body.hidden = !body.hidden; clampPanel(); };
  $('#__scan').onclick = refreshProducts;
  $('#__reply_read').onclick = readQuickReplies;
  $('#__reply_list').onchange = captureReplies;
  $('#__reply_none').onclick = () => {draftReplies.clear();renderReplies();};
  $('#__pick').onchange = captureDraft;
  for (const kind of KINDS) $('#__resume_' + kind).onclick = () => resumeJob(kind);
  $('#__save').onclick = () => {
    captureDraft();captureReplies();
    const next = normalize({ ...CFG, explainOn: $('#__eon').checked, commentOn: $('#__con').checked,
      pinOn: $('#__pon').checked, pinMins: $('#__pmin').value,
      autoRecoverOn: $('#__auto').checked, recoverMins: $('#__recover').value,
      order: $('#__order').value, explainMins: $('#__emin').value, commentMins: $('#__cmin').value, jitter: $('#__jit').value,
      comments: (QUICK.length?QUICK:CFG.comments).filter(t=>draftReplies.has(t)), products: productPool().filter(p => draftIds.has(p.id)) });
    try { localStorage.setItem(KEY, JSON.stringify(next)); }
    catch { log('⚠ 保存失败，设置未应用，请检查浏览器存储空间'); return; }
    applyConfig(next); fill();
    log('设置已保存：弹 ' + (CFG.products.map(p => p.seq + '号').join('、') || '（未选）') + (S.on ? '；变更的任务已重新计时' : ''));
  };
  function clampPanel() {
    const r = panel.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(r.left, innerWidth - r.width - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(r.top, innerHeight - r.height - 8)) + 'px'; panel.style.bottom = 'auto';
  }
  let drag = null;
  $('#__head').onpointerdown = e => {
    if (e.button !== 0 || e.target.closest('button,input,select,textarea')) return;
    const r = panel.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top };
    $('#__head').setPointerCapture(e.pointerId); e.preventDefault();
  };
  $('#__head').onpointermove = e => {
    if (!drag) return;
    panel.style.left = e.clientX - drag.x + 'px'; panel.style.top = e.clientY - drag.y + 'px'; panel.style.bottom = 'auto'; clampPanel();
  };
  function endDrag() {
    if (!drag) return; drag = null;
    const r = panel.getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch {}
  }
  $('#__head').onpointerup = endDrag; $('#__head').onpointercancel = endDrag;
  const mount = () => { if (!document.getElementById(panel.id)) document.body.appendChild(panel); };
  fill(); renderHead(); mount();
  try { const p = JSON.parse(localStorage.getItem(POS_KEY)); if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
    panel.style.left = p.x + 'px'; panel.style.top = p.y + 'px'; panel.style.bottom = 'auto'; clampPanel();
  } } catch {}
  window.addEventListener('resize', clampPanel);
  window.addEventListener('pagehide', () => { quickReadController?.abort();scanController?.abort(); stop('页面关闭或刷新'); });
  document.addEventListener('input', e => {
    if (e.isTrusted && e.target === document.querySelector('textarea[placeholder*="Enter键发送"]')) S.editRevision++;
  }, true);
  for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, e => {
    if (!e.isTrusted) return;
    const ta = document.querySelector('textarea[placeholder*="Enter键发送"]');
    if (e.target === ta || e.target?.closest?.('[class*="quick-reply-"]')) S.editRevision++;
  }, true);
  function syncInventory(now) {
    if (scanController || (!rows().length && totalCount() !== 0) || navigator.onLine === false) return;
    const changed = !S.inventoryKnown || (totalCount() != null && totalCount() !== ALL.length) || rows().some(r => {
      const p = ALL.find(a => a.id === rowId(r));
      return !p || p.seq !== rowSeq(r) || p.name !== rowName(r) || p.price !== rowPrice(r);
    });
    if (changed && !S.dirtyAt) S.dirtyAt = now || 1;
    const active = document.activeElement;
    if (active && !active.closest('#__douyin_panel') && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
    if (now >= S.nextScanAt && ((S.dirtyAt && now - S.dirtyAt >= 1000) || now - S.inventoryAt >= 60000)) refreshProducts(false);
  }
  let lastHeartbeat = Date.now();
  function heartbeat() {
    mount(); const now = Date.now();
    if (S.on && now - lastHeartbeat > 60000) log('检测到页面计时中断，检查并恢复未执行任务；已提交的操作不会补发');
    lastHeartbeat = now;
    if (S.on) guard();
    if (S.on) for (const kind of KINDS) {
      const job = S.jobs[kind];
      if (!CFG[kind + 'On'] || job.blocked) continue;
      if (job.controller && now - job.started > 120000) {
        const submitted = job.submitted; cancelJob(kind);
        if (submitted) blockJob(kind, '任务超时且已提交，结果待确认', 'submitted');
        else { log(LABELS[kind] + '等待超时，取消旧任务并重新计时'); schedule(kind, jobDelay(kind)); }
      } else if (!job.controller && (!job.timer || (job.due && now - job.due > 5000))) {
        log(LABELS[kind] + '计时延迟，恢复一次调度'); schedule(kind, 0);
      }
    }
    const ta = document.querySelector('textarea[placeholder*="Enter键发送"]');
    if (ta && !ta.value.trim() && document.activeElement !== ta && !S.jobs.comment.blocked) S.jobs.comment.waiting = '';
    syncInventory(now); recoverJobs(now);
    renderHead();
  }
  setInterval(heartbeat, 1000);
  document.addEventListener('visibilitychange', heartbeat);
  window.addEventListener('pageshow', heartbeat); window.addEventListener('online', heartbeat);
  log('v2.2 已加载：商品讲解、原生快捷评论、随机置顶及自动恢复；手动开始才运行');
  setTimeout(() => { if (!S.on && rows().length) refreshProducts(); }, 4000);
})();
