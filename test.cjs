const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(process.env.DOUYIN_TEST_SCRIPT || __dirname + '/douyin-live-auto.user.js', 'utf8');
const sharedLocks = () => {
  const held = new Set();
  return { async request(name, options, callback) {
    if (held.has(name)) return callback(null);
    held.add(name); try { return await callback({ name }); } finally { held.delete(name); }
  } };
};
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function harness({ locks = sharedLocks(), config = {}, scroll = false, clearOnSend = true, confirmExplain = true,
  pinComments = [], confirmPin = true, initialPin = '', restoreDraft = false, maxLength = -1 } = {}) {
  let now = 0, serial = 0, sent = 0, clicked = 0;
  const pinnedClicks = [], sentTexts = [];
  let pinnedText = initialPin;
  const timers = new Map(), elements = new Map(), picks = [], quickPicks = [], intervals = [], listeners = new Map();
  const storage = new Map([['__douyin_live_auto_cfg_v2', JSON.stringify({ products: [{id:'1000000000000004',seq:1,name:'测试商品一'}, {id:'1000000000000002',seq:2,name:'测试商品二'}], comments:['测试话术甲','测试话术乙'], ...config })]]);
  class Element {
    constructor(id = '') { this.id = id; this.style = {}; this.value = ''; this.checked = false; this.hidden = false; this.disabled = false;
      this.isConnected = true; this.children = []; this.dataset = {}; this.innerText = ''; this.textContent = ''; }
    set innerHTML(html) {
      this.html = html;
      if (this.id === '__douyin_panel') for (const m of html.matchAll(/id="([^"]+)"/g)) elements.set(m[1], new Element(m[1]));
      if (this.id === '__pick') {
        picks.length = 0;
        for (const m of html.matchAll(/data-id="([^"]+)"([^>]*)>/g)) { const p = new Element(); p.dataset.id = m[1]; p.checked = m[2].includes('checked'); picks.push(p); }
      }
      if(this.id==='__reply_list') {
        quickPicks.length=0;
        for(const m of html.matchAll(/class="__qr"[^>]*data-index="(\d+)"([^>]*)>/g)) {
          const p=new Element();p.dataset.index=m[1];p.checked=m[2].includes('checked');quickPicks.push(p);
        }
      }
    }
    get innerHTML() { return this.html; }
    querySelector(selector) { return elements.get(selector.slice(1)) || null; }
    querySelectorAll(selector) { return selector === '.__pk:checked' ? picks.filter(x => x.checked) : selector==='.__qr:checked'?quickPicks.filter(x=>x.checked):[]; }
    closest() { return null; }
    getAttribute() { return null; }
    dispatchEvent() {}
    getBoundingClientRect() { return { left: 12, top: 12, width: 340, height: 500 }; }
  }
  class Textarea extends Element {
    get value() { return this._value || ''; }
    set value(v) { this._value = v; }
    closest() { return wrap; }
  }
  const ta = new Textarea();
  ta.maxLength = maxLength; ta.tagName = 'TEXTAREA';
  const btn = new Element(); btn.textContent = '发送';
  btn.click = () => { sent++; const text = ta.value; sentTexts.push(text); if (clearOnSend) ta.value = '';
    if (restoreDraft) { const id = ++serial; timers.set(id, { fn: () => { ta.value = text; }, at: now + 500 }); }
  };
  const wrap = { querySelectorAll: () => [btn] };
  const sc = new Element(); sc.scrollTop = 87; sc.scrollHeight = scroll ? 1000 : 300; sc.clientHeight = 300;
  const products = ['1000000000000004', '1000000000000002', '1000000000000003'].map((id, i) => {
    const row = new Element(); row.parentElement = sc; row.innerText = '【测试商品】这是足够长的商品名称' + i + '\n¥129';
    const b = new Element(); b.innerText = '讲解'; b.click = () => { clicked++; if (confirmExplain) b.innerText = '取消讲解'; };
    row.getAttribute = key => key === 'aria-label' ? id + '--test' : null;
    row.querySelector = sel => sel === 'input' ? { value: String(i + 1) } : b;
    return row;
  });
  let visibleRows = scroll ? [products[0]] : products;
  const body = new Element(); body.innerText = '全部(3)';
  body.appendChild = el => { elements.set(el.id, el); };
  sc.parentElement = body;
  const pinRows = pinComments.map(({ name = '测试账号', text }) => {
    const row = new Element(), button = new Element();
    button.querySelector = () => ({});
    button.click = () => { pinnedClicks.push(text); if (confirmPin) pinnedText = text; };
    row.querySelector = sel => ({ textContent: sel.includes('item-name-') ? name + '：' : text });
    row.querySelectorAll = () => [button]; return row;
  });
  const pinWrap = { querySelector: sel => ({ textContent: sel.includes('number-') ? (pinnedText ? '1' : '0') : sel.includes('status-') ? '审核中' : pinnedText }) };
  const document = { body, activeElement: null, addEventListener(name, fn) { listeners.set(name, fn); }, createElement: () => new Element(), getElementById: id => id === 'comment_all_tab_list_container' ? { querySelectorAll: () => pinRows } : elements.get(id),
    querySelector: sel => sel.includes('panel-profile-name-') ? { textContent: '测试账号' } : sel.includes('wrap-If9q') ? pinWrap : ta,
    querySelectorAll: sel => sel === '[data-rfd-draggable-id]' ? visibleRows : [] };
  const clockDate = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const navigator = { locks, onLine: true };
  const context = vm.createContext({ console, document, navigator, location: { pathname: '/livesite/live/current' },
    HTMLTextAreaElement: Textarea, DOMException, AbortController, Event: class {}, MouseEvent: class {}, Date: clockDate, Math,
    getComputedStyle: () => ({ overflowY: scroll ? 'auto' : 'visible' }), innerWidth: 1500, innerHeight: 1000,
    window: { addEventListener() {} }, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, v) => storage.set(key, v), removeItem: key => storage.delete(key) },
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: fn => { intervals.push(fn); return ++serial; } });
  const exposed = source.replace(/\}\)\(\);\s*$/, 'globalThis.api = { S, start, stop, applyConfig, refreshProducts, resumeJob, readQuickReplies, captureReplies, get quick() { return QUICK; }, get cfg() { return CFG; } }; })();');
  vm.runInContext(exposed, context);
  const h = { api: context.api, elements, picks, quickPicks, ta, sc, products, document, storage, pinnedClicks, navigator, sentTexts,
    get sent() { return sent; }, get clicked() { return clicked; },
    setRows(value) { visibleRows = value; }, heartbeat() { intervals.forEach(fn => fn()); }, fire(name,event){listeners.get(name)?.(event);},
    defer(fn,ms) { return context.setTimeout(fn,ms); },
    async wake(ms) {
      // 浏览器暂停期间时钟前进，恢复后旧定时器在当前时间触发，不能把时钟倒回原到期点。
      now += ms;
      const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a,b) => a[1].at-b[1].at);
      for (const [id, task] of due) if (timers.delete(id)) task.fn();
      await flush();
    },
    setPinned(text) { pinnedText = text; }, get pinnedText() { return pinnedText; },
    edit(text) { ta.value = text; listeners.get('input')?.({ isTrusted: true, target: ta }); },
    jump(ms) { now += ms; }, loseTimers() { timers.clear(); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush(); const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      now = end; await flush();
    },
    async close() { this.api.stop('test'); await flush(); },
  };
  quickReplyFixture(h,h.api.cfg.comments);return h;
}
test('停止可取消等待发送的评论，并清理脚本草稿', async () => {
  const h = harness({ config: { explainOn: false } }); h.api.start(); await flush();
  await h.advance(5000); assert.notEqual(h.ta.value, ''); h.api.stop(); await flush(); await h.advance(1000);
  assert.equal(h.sent, 0); assert.equal(h.ta.value, ''); assert.equal(h.api.S.phase, 'idle');
});
test('停止可中断滚动查找；恢复列表位置且不会点击', async () => {
  const h = harness({ scroll: true, config: { commentOn: false, products: [{ id: '1000000000000002', seq: 2, name: '二号商品' }] } });
  h.api.start(); await h.advance(0); h.api.stop(); await flush(); await h.advance(2000);
  assert.equal(h.clicked, 0); assert.equal(h.sc.scrollTop, 87); assert.equal(h.api.S.operations.size, 0);
});
test('运行中关闭再开启评论会恢复调度；旧等待任务不再发送', async () => {
  const h = harness({ config: { explainOn: false, jitter: 0 } }); h.api.start(); await h.advance(5000);
  h.api.applyConfig({ ...h.api.cfg, commentOn: false }); await flush(); assert.equal(h.ta.value, '');
  h.api.applyConfig({ ...h.api.cfg, commentOn: true, commentMins: 0.5 });
  await h.advance(29999); assert.equal(h.sent, 0); await h.advance(601); assert.equal(h.sent, 1); await h.close();
});
test('同源两个标签页只能有一个运行，停止后另一个可接手', async () => {
  const locks = sharedLocks(), a = harness({ locks }), b = harness({ locks });
  a.api.start(); b.api.start(); await flush(); assert.equal(a.api.S.on, true); assert.equal(b.api.S.on, false);
  assert.match(b.api.S.log.join('\n'), /另一个/); await a.close(); b.api.start(); await flush(); assert.equal(b.api.S.on, true); await b.close();
});
test('讲解点击无确认时不能记录成功；连续三次异常仅暂停讲解', async () => {
  const h = harness({ confirmExplain: false, config: { commentOn: false, explainMins: 0.5, jitter: 0 } });
  h.api.start(); await h.advance(70000);
  assert.equal(h.clicked, 3); assert.equal(h.api.S.on, true); assert.equal(h.api.S.jobs.explain.blocked, true);
  assert.doesNotMatch(h.api.S.log.join('\n'), /已确认讲解/); assert.match(h.api.S.log.join('\n'), /连续失败/); await h.close();
});
test('评论点击后未清空则暂停评论，不盲目重复发送', async () => {
  const h = harness({ clearOnSend: false, config: { explainOn: false, commentMins: 0.5, jitter: 0 } });
  h.api.start(); await h.advance(90000); assert.equal(h.sent, 1); assert.equal(h.api.S.jobs.comment.blocked, true);
  assert.doesNotMatch(h.api.S.log.join('\n'), /评论已提交/); await h.close();
});
test('评论框聚焦时不覆盖人工输入', async () => {
  const h = harness({ config: { explainOn: false } }); h.document.activeElement = h.ta;
  h.api.start(); await h.advance(6000); assert.equal(h.sent, 0); assert.equal(h.ta.value, ''); await h.close();
});
test('刷新商品列表保留尚未保存的勾选', async () => {
  const h = harness(); h.picks[0].checked = false;
  await h.api.refreshProducts(); assert.equal(h.picks.find(p => p.dataset.id === '1000000000000004').checked, false);
  h.picks.find(p => p.dataset.id === '1000000000000003').checked = true;
  await h.api.refreshProducts(); assert.equal(h.picks.find(p => p.dataset.id === '1000000000000003').checked, true);
  h.elements.get('__save').onclick(); assert.equal(h.api.cfg.products.some(p => p.id === '1000000000000003'), true);
});
test('保留v1.2配置、无效数值回退、日志文本不解析HTML', () => {
  const h = harness({ config: { commentMins: 2.5, jitter: 0, explainOn: false } });
  assert.equal(h.api.cfg.commentMins, 2.5); assert.equal(h.api.cfg.jitter, 0); assert.equal(h.api.cfg.explainOn, false);
  h.elements.get('__emin').value = 'Infinity'; h.elements.get('__save').onclick(); assert.equal(h.api.cfg.explainMins, 3);
  assert.equal(h.elements.get('__log').innerHTML, undefined); assert.ok(h.elements.get('__log').textContent.includes('设置已保存'));
});
test('下播时自动停止，下播状态不能启动', async () => {
  const h = harness(); h.api.start(); await flush(); assert.equal(h.api.S.on, true);
  h.document.body.innerText = '我的直播间 未开播 直播已结束'; h.setRows([]); h.document.querySelector = () => null;
  h.heartbeat(); await flush(); assert.equal(h.api.S.on, false); assert.equal(h.api.S.phase, 'idle');
  await h.api.start(); assert.equal(h.api.S.on, false); assert.match(h.api.S.log.join('\n'), /未启动/);
});
test('置顶可单独运行，首次等待完整间隔，去重并排除观众与非预设评论', async () => {
  const h = harness({ config: { explainOn: false, commentOn: false, pinOn: true, pinMins: 0.5, jitter: 50, comments: ['甲', '乙'] },
    initialPin: '甲', pinComments: [{ text: '甲' }, { text: '乙' }, { text: '乙' }, { name: '观众', text: '甲' }, { text: '无关' }] });
  h.api.start(); await h.advance(29999); assert.deepEqual(h.pinnedClicks, []);
  await h.advance(1); assert.deepEqual(h.pinnedClicks, ['乙']); assert.equal(h.sent, 0); assert.equal(h.clicked, 0);
  assert.match(h.api.S.log.join('\n'), /置顶区域已更新（审核中）/);
  await h.advance(30000); assert.deepEqual(h.pinnedClicks, ['乙', '甲']); await h.close();
});
test('置顶无候选不发送评论、不累计失败；旧配置默认关闭置顶', async () => {
  assert.equal(harness().api.cfg.pinOn, false);
  const h = harness({ config: { explainOn: false, commentOn: false, pinOn: true, pinMins: 0.5 }, pinComments: [{ name: '观众', text: '几大几小，小朋友身高，一条弹幕打出来' }] });
  h.api.start(); await h.advance(90000); assert.equal(h.api.S.on, true); assert.equal(h.pinnedClicks.length, 0);
  assert.equal(h.sent, 0); assert.equal(h.api.S.jobs.pin.failures, 0); await h.close();
});
test('置顶结果不明仅暂停置顶，后续不会盲目重试', async () => {
  const h = harness({ config: { explainOn: false, commentOn: false, pinOn: true, pinMins: 0.5, comments: ['甲'] }, pinComments: [{ text: '甲' }], confirmPin: false });
  h.api.start(); await h.advance(120000); assert.equal(h.pinnedClicks.length, 1);
  assert.equal(h.api.S.jobs.pin.blocked, true); assert.equal(h.api.S.on, true);
  assert.doesNotMatch(h.api.S.log.join('\n'), /置顶区域已更新/); await h.close();
});
test('置顶间隔修改重新计时，关闭或停止会取消后续置顶', async () => {
  const h = harness({ config: { explainOn: false, commentOn: false, pinOn: true, pinMins: 0.5, comments: ['甲', '乙'] }, pinComments: [{ text: '甲' }, { text: '乙' }] });
  h.api.start(); await h.advance(20000); h.api.applyConfig({ ...h.api.cfg, pinMins: 1 });
  await h.advance(59999); assert.equal(h.pinnedClicks.length, 0); await h.advance(1); assert.equal(h.pinnedClicks.length, 1);
  h.api.applyConfig({ ...h.api.cfg, pinOn: false }); await h.advance(120000); assert.equal(h.pinnedClicks.length, 1);
  h.api.applyConfig({ ...h.api.cfg, pinOn: true }); await h.close(); await h.advance(120000); assert.equal(h.pinnedClicks.length, 1);
});
test('输入框有草稿会明确显示异常，清空后可恢复评论且不用重启讲解', async () => {
  const h = harness({ config: { jitter: 0, commentMins: 0.5 } }); h.ta.value = '保留人工草稿';
  h.api.start(); await h.advance(6000); h.heartbeat();
  assert.match(h.elements.get('__st').textContent, /部分任务需处理/);
  assert.match(h.elements.get('__health').textContent, /输入框有草稿/);
  h.api.resumeJob('comment'); assert.equal(h.ta.value, '保留人工草稿'); assert.equal(h.sent, 0);
  h.ta.value = ''; h.api.resumeJob('comment'); await h.advance(31400);
  assert.equal(h.sent, 1); assert.equal(h.api.S.on, true); await h.close();
});
test('页面先清空再回填草稿时不能误判发送成功，也不能自动重发', async () => {
  const h = harness({ restoreDraft: true, config: { explainOn: false, commentMins: 0.5, jitter: 0 } });
  h.api.start(); await h.advance(90000); assert.equal(h.sent, 1); assert.equal(h.api.S.jobs.comment.blocked, true);
  assert.doesNotMatch(h.api.S.log.join('\n'), /评论已提交/); await h.close();
});
test('话术遵守实际输入框长度限制，全部超长时明确暂停', async () => {
  const h = harness({ maxLength: 3, config: { explainOn: false, comments: ['短句', '超长的内容'] } });
  h.api.start(); await h.advance(5000); assert.equal(h.ta.value, '短句'); await h.close();
  const b = harness({ maxLength: 3, config: { explainOn: false, comments: ['超长的内容'] } });
  b.api.start(); await b.advance(6000); assert.equal(b.sent, 0); assert.equal(b.api.S.jobs.comment.blocked, true);
  assert.match(b.api.S.jobs.comment.reason, /3 字限制/); await b.close();
});
test('定时任务丢失后心跳只恢复一轮，不追补大量历史评论', async () => {
  const h = harness({ config: { explainOn: false, commentMins: 0.5, jitter: 0 } });
  h.api.start(); await h.advance(7000); assert.equal(h.sent, 1); h.loseTimers(); h.jump(3600000);
  h.heartbeat(); h.heartbeat(); await h.advance(1700); assert.equal(h.sent, 2);
  assert.equal(h.api.S.operations.size, 0); await h.close();
});
test('恢复时取消过期的待发送草稿，不能执行旧任务再重复调度', async () => {
  const h = harness({ config: { explainOn: false, jitter: 0 } }); h.api.start(); await h.advance(5000);
  assert.notEqual(h.ta.value, ''); h.jump(180000); h.heartbeat(); await flush();
  assert.equal(h.sent, 0); assert.equal(h.ta.value, ''); await h.advance(1000); assert.equal(h.sent, 0); await h.close();
});
test('已点击提交的任务超时，恢复心跳仍须保留暂停，不能补发', async () => {
  const h = harness({ clearOnSend: false, config: { explainOn: false, jitter: 0 } }); h.api.start(); await h.advance(5600);
  assert.equal(h.sent, 1); h.jump(180000); h.heartbeat(); await flush(); h.heartbeat(); await h.advance(600000);
  assert.equal(h.sent, 1); assert.equal(h.api.S.jobs.comment.blocked, true); await h.close();
});
test('离线跳过不累计失败，网络恢复后继续正常调度', async () => {
  const h = harness({ config: { explainOn: false, commentMins: 0.5, jitter: 0 } }); h.navigator.onLine = false;
  h.api.start(); await h.advance(120000); assert.equal(h.sent, 0); assert.equal(h.api.S.jobs.comment.failures, 0);
  h.navigator.onLine = true; await h.advance(31400); assert.equal(h.sent, 1); await h.close();
});
test('模拟24小时连续运行保持调度且不遗留执行任务', async () => {
  const h = harness({ config: { jitter: 0, pinOn: true, pinMins: 5, comments: ['甲', '乙'] }, pinComments: [{ text: '甲' }, { text: '乙' }] });
  h.api.start(); await h.advance(86400000); assert.equal(h.api.S.on, true);
  assert.ok(h.sent > 280 && h.sent <= 288); assert.equal(h.pinnedClicks.length, 288);
  assert.ok(h.api.S.log.length <= 100); assert.ok(h.api.S.operations.size <= 1); await h.close();
});

function replaceRow(row, id, { name, seq, price = '129' } = {}) {
  const next = Object.create(row);
  next.getAttribute = key => key === 'aria-label' ? id + '--test' : null;
  if (name) next.innerText = name + '\n¥' + price;
  next.querySelector = sel => sel === 'input' && seq ? { value: String(seq) } : row.querySelector(sel);
  return next;
}
test('完整货架删除历史重复链接，唯一同名同价换链并保留未保存的勾选', async () => {
  const name = '【测试活动】示例夜间票+指定日期可用';
  const h = harness({ config: { products: [{ id: '1000000000000004', seq: 1, name, price: '129' }] } });
  h.picks[0].checked = false;
  const replacement = replaceRow(h.products[0], '1000000000000005', { name });
  h.setRows([replacement, h.products[1]]); h.document.body.innerText = '全部(2)';
  await h.api.refreshProducts();
  assert.deepEqual(h.picks.map(p => p.dataset.id), ['1000000000000005', '1000000000000002']);
  assert.equal(h.api.cfg.products[0].id, '1000000000000005');
  assert.equal(h.picks[0].checked, false); // 换链不能撤销用户尚未保存的取消勾选
  assert.equal(h.api.S.missingProducts.length, 0);
  assert.match(h.api.S.log.join('\n'), /商品换链已对应/);
});
test('两个实际同价链接均保留，不按价格合并；匹配有歧义不擅自替换', async () => {
  const name = '【测试商品】这是足够长的相同商品名称';
  const h = harness({ config: { products: [{ id: '1000000000000007', seq: 1, name, price: '129' }] } });
  h.setRows([replaceRow(h.products[0], '1000000000000001', { name }), replaceRow(h.products[1], '1000000000000006', { name })]);
  h.document.body.innerText = '全部(2)'; await h.api.refreshProducts();
  assert.equal(h.picks.length, 2); assert.equal(h.api.cfg.products[0].id, '1000000000000007');
  assert.equal(h.api.S.missingProducts.length, 1);
  assert.match(h.elements.get('__inventory').textContent, /无法唯一对应/);
});
test('不完整扫描或混入同序号新旧链接时保留上次确认货架', async () => {
  const h = harness(); await h.api.refreshProducts();
  const ids = h.picks.map(p => p.dataset.id);
  h.setRows([h.products[0]]); await h.api.refreshProducts();
  assert.deepEqual(h.picks.map(p => p.dataset.id), ids);
  h.setRows([h.products[0], replaceRow(h.products[0], '1000000000000007'), h.products[1]]);
  await h.api.refreshProducts(); assert.deepEqual(h.picks.map(p => p.dataset.id), ids);
  assert.match(h.elements.get('__inventory').textContent, /等待完整扫描/);
});
test('正常自动同步不会重置商品轮换进度，商品减少不停止其他任务', async () => {
  const h = harness({ config: { commentOn: false, jitter: 0 } });
  await h.api.refreshProducts(); h.api.start(); await h.advance(1);
  assert.equal(h.api.S.idx, 1); await h.api.refreshProducts(); assert.equal(h.api.S.idx, 1);
  h.setRows([h.products[1], h.products[2]]); h.document.body.innerText = '全部(2)';
  await h.api.refreshProducts(); h.heartbeat(); await flush();
  assert.equal(h.api.S.on, true); assert.equal(h.api.S.missingProducts.length, 1);
  await h.advance(180000); assert.equal(h.api.S.lastP, '1000000000000002'); await h.close();
});
test('页面可见商品换链后，心跳自动刷新并对应当前 ID', async () => {
  const h = harness(); await h.advance(5000); // 完成首次自动读取
  const name = h.api.cfg.products[0].name;
  h.setRows([replaceRow(h.products[0], '1000000000000005', { name }), h.products[1], h.products[2]]);
  h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.api.cfg.products[0].id, '1000000000000005');
  assert.equal(h.picks.some(p => p.dataset.id === '1000000000000004'), false);
});
test('货架变为零个商品也会同步清空显示，评论功能继续运行', async () => {
  const h = harness({ config: { explainOn: false, jitter: 0 } }); await h.advance(5000);
  h.api.start(); await flush(); h.setRows([]); h.document.body.innerText = '全部(0)';
  h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.picks.length, 0); assert.equal(h.api.S.on, true); assert.equal(h.sent, 1); await h.close();
});
test('连续讲解失败冷却并稳定15秒后自动恢复，重新等待完整间隔', async () => {
  const h = harness({ confirmExplain: false, config: { commentOn: false, explainMins: 0.5, jitter: 0 } });
  h.api.start(); await h.advance(140000); assert.equal(h.api.S.jobs.explain.blocked, true);
  h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.api.S.jobs.explain.blocked, false); assert.equal(h.api.S.jobs.explain.recoverAttempts, 1);
  assert.equal(h.clicked, 3); await h.advance(29999); assert.equal(h.clicked, 3);
  await h.advance(1); assert.equal(h.clicked, 4); await h.close();
});
test('恢复后再次失败延长冷却时间，不会连续反复重启', async () => {
  const h = harness({ confirmExplain: false, config: { commentOn: false, explainMins: 0.5, jitter: 0 } });
  h.api.start(); await h.advance(140000); h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  await h.advance(100000); const j = h.api.S.jobs.explain;
  assert.equal(j.blocked, true); const due = j.recoverAt;
  assert.ok(due > 255000 + 100000 && due < 255000 + 120000);
  await h.advance(due - 255000); h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(j.recoverAttempts, 2); await h.advance(100000);
  assert.equal(j.blocked, true); assert.ok(j.recoverAt - (due + 115000) > 280000); await h.close();
});
test('完整货架中被虚拟列表隐藏的已选商品仍可自动恢复调度', async () => {
  const h = harness({ confirmExplain: false, config: { commentOn: false, explainMins: 0.5, jitter: 0,
    products: [{ id: '1000000000000002', seq: 2, name: '二号商品' }] } });
  await h.api.refreshProducts(); h.api.start(); await h.advance(140000);
  h.setRows([h.products[0]]); h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.api.S.jobs.explain.blocked, false); assert.equal(h.clicked, 3); await h.close();
});
test('评论结果不明自动放弃无人接手的脚本草稿，正常间隔后继续', async () => {
  const h = harness({ clearOnSend: false, config: { explainOn: false, commentMins: 0.5, jitter: 0 } });
  h.api.start(); await h.advance(80000); h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.api.S.jobs.comment.blocked, false); assert.equal(h.ta.value, ''); assert.equal(h.sent, 1);
  await h.advance(29999); assert.equal(h.sent, 1); await h.advance(601); assert.equal(h.sent, 2); await h.close();
});
test('人工接手同样文字也不能被自动清空或发送；清空后可自动恢复', async () => {
  const h = harness({ clearOnSend: false, config: { explainOn: false, commentMins: 0.5, jitter: 0 } });
  h.api.start(); await h.advance(20000); const text = h.ta.value; h.edit(text);
  await h.advance(60000); h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.api.S.jobs.comment.blocked, true); assert.equal(h.ta.value, text); assert.equal(h.sent, 1);
  h.edit(''); await h.advance(60000); h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.api.S.jobs.comment.blocked, false); await h.close();
  const before = harness({ config: { explainOn: false } }); before.api.start(); await before.advance(5000);
  const draft = before.ta.value; before.edit(draft); await before.advance(1000);
  assert.equal(before.sent, 0); assert.equal(before.ta.value, draft); await before.close();
});
test('关闭自动恢复或手动停止后不会自动开启任务', async () => {
  const h = harness({ clearOnSend: false, config: { explainOn: false, autoRecoverOn: false } });
  h.api.start(); await h.advance(80000); h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.api.S.jobs.comment.blocked, true);
  h.api.applyConfig({ ...h.api.cfg, autoRecoverOn: true }); await h.advance(60000); h.heartbeat();
  await h.close(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.api.S.on, false); assert.equal(h.sent, 1); assert.equal(h.api.S.phase, 'idle');
});
test('其他人改置顶后等待稳定，保留当前置顶，完整间隔后换另一条预设', async () => {
  const h = harness({ confirmPin: false, config: { explainOn: false, commentOn: false, pinOn: true, pinMins: 0.5, comments: ['甲', '乙'], jitter: 0 },
    pinComments: [{ text: '甲' }, { text: '乙' }] });
  h.api.start(); await h.advance(30000); const uncertain = h.pinnedClicks[0];
  h.setPinned('另一位运营的评论'); await h.advance(1000);
  assert.equal(h.api.S.jobs.pin.blocked, true); assert.match(h.api.S.jobs.pin.reason, /操作期间变化/);
  await h.advance(60000); h.heartbeat(); await h.advance(10000); h.setPinned('另一位运营的新评论'); h.heartbeat();
  await h.advance(10000); h.heartbeat(); assert.equal(h.api.S.jobs.pin.blocked, true);
  await h.advance(5000); h.heartbeat(); await flush();
  assert.equal(h.api.S.jobs.pin.blocked, false); assert.equal(h.pinnedText, '另一位运营的新评论');
  assert.equal(h.pinnedClicks.length, 1); await h.advance(30000); assert.equal(h.pinnedClicks.length, 2);
  assert.notEqual(h.pinnedClicks[1], uncertain); await h.close();
});
test('置顶迟到结果可确认，恢复时不再次点击同一条', async () => {
  const h = harness({ confirmPin: false, config: { explainOn: false, commentOn: false, pinOn: true, pinMins: 0.5, comments: ['甲'] }, pinComments: [{ text: '甲' }] });
  h.api.start(); await h.advance(101000); h.setPinned('甲'); h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.equal(h.api.S.jobs.pin.blocked, false); assert.equal(h.api.S.lastPin, '甲');
  await h.advance(30000); assert.equal(h.pinnedClicks.length, 1); await h.close();
});
test('多个功能异常重建调度后仍持有浏览器锁，手动停止能正常释放', async () => {
  const locks = sharedLocks();
  const h = harness({ locks, confirmExplain: false, clearOnSend: false, config: { explainMins: 0.5, commentMins: 0.5, jitter: 0 } });
  h.api.start(); await h.advance(140000); h.heartbeat(); await h.advance(15000); h.heartbeat(); await flush();
  assert.match(h.api.S.log.join('\n'), /自动重建助手调度/);
  assert.equal(h.api.S.jobs.comment.blocked, false); assert.equal(h.api.S.jobs.explain.blocked, false);
  const b = harness({ locks }); b.api.start(); await flush(); assert.equal(b.api.S.on, false);
  await h.close(); assert.equal(h.api.S.phase, 'idle'); b.api.start(); await flush(); assert.equal(b.api.S.on, true); await b.close();
});
function quickReplyFixture(h, texts, { close = true, truncate = false, fillDelay = 0, blurDelay = 0 } = {}) {
  let open = false, chosen = [];
  const node = text => ({ innerText:text, textContent:text, isConnected:true, children:[],
    getClientRects:()=>[1],closest:()=>null,getAttribute:()=>null,dispatchEvent(){} });
  const items=texts.map(text=>{const e=node(text);e.click=()=>{chosen.push(text);const fill=()=>{h.ta.value=truncate?text.slice(0,1):text;};if(fillDelay)h.defer(fill,fillDelay);else fill();};return e;});
  const panel=node('快捷回复推荐');panel.querySelectorAll=()=>items;
  const target=node('直播数据');target.click=()=>{if(close)open=false;};
  h.ta.focus=()=>{h.document.activeElement=h.ta;open=true;};
  h.ta.blur=()=>{h.document.activeElement=null;if(blurDelay)h.defer(()=>{open=true;},blurDelay);};
  const original=h.document.querySelectorAll;
  h.document.querySelectorAll=s=>s==='[class*="quick-reply-"]'?(open?[panel]:[]):s==='[class*="header-"] > div'?[target]:original(s);
  return {get open(){return open;},get chosen(){return chosen;},show(){open=true;}};
}
test('原生快捷回复只发面板同文话术，按顺序循环并收起弹层',async()=>{
  const h=harness({config:{explainOn:false,comments:['甲','乙'],commentMins:0.5,jitter:0,nativeRepliesOn:true}});
  const f=quickReplyFixture(h,['甲','历史过期活动','乙']);h.api.start();await h.advance(70000);
  assert.deepEqual(h.sentTexts,['甲','乙','甲']);assert.equal(f.open,false);assert.equal(h.document.activeElement,null);
  assert.equal(h.api.S.jobs.comment.blocked,false);await h.close();
});
test('无同文快捷回复会跳过，失焦后下一轮仍能继续',async()=>{
  const h=harness({config:{explainOn:false,comments:['页面不存在','乙'],commentMins:0.5,jitter:0,nativeRepliesOn:true}});
  const f=quickReplyFixture(h,['乙']);h.api.start();await h.advance(40000);
  assert.deepEqual(h.sentTexts,['乙']);assert.equal(f.open,false);assert.equal(h.document.activeElement,null);await h.close();
});
test('原生条目异步填入且失焦后旧渲染重开弹层时，等待更新后再收起并发送',async()=>{
  const h=harness({config:{explainOn:false,comments:['异步话术'],jitter:0}});
  const f=quickReplyFixture(h,['异步话术'],{fillDelay:300,blurDelay:100});
  h.api.start();await h.advance(9000);
  assert.deepEqual(h.sentTexts,['异步话术']);assert.equal(f.open,false);
  assert.equal(h.api.S.jobs.comment.blocked,false);await h.close();
});
test('等待原生异步填入期间人工接手，保留草稿且不发送',async()=>{
  const h=harness({config:{explainOn:false,comments:['异步话术'],jitter:0}});
  quickReplyFixture(h,['异步话术'],{fillDelay:225});h.api.start();
  await h.advance(5250);h.edit('人工接手');await h.advance(1000);
  assert.equal(h.sent,0);assert.equal(h.ta.value,'人工接手');await h.close();
});
test('原生快捷回复被截断不能发送；人工接手也不能发送或清除',async()=>{
  const h=harness({config:{explainOn:false,comments:['完整话术'],nativeRepliesOn:true}});
  quickReplyFixture(h,['完整话术'],{truncate:true});h.api.start();await h.advance(6400);assert.equal(h.sent,0);await h.close();
  const b=harness({config:{explainOn:false,comments:['完整话术'],nativeRepliesOn:true}});quickReplyFixture(b,['完整话术']);
  b.api.start();await b.advance(5000);b.edit('人工输入');await b.advance(2000);assert.equal(b.sent,0);assert.equal(b.ta.value,'人工输入');await b.close();
});
test('原生回复先收起弹层再发送；无法收起时本轮不发送且只暂停评论',async()=>{
  for(const close of [true,false]){
    const h=harness({config:{explainOn:false,comments:['甲'],jitter:0}});const f=quickReplyFixture(h,['甲'],{close});f.show();
    h.api.start();await h.advance(9000);assert.equal(h.sent,close?1:0);assert.equal(h.api.S.jobs.comment.blocked,!close);assert.equal(h.api.S.on,true);await h.close();
  }
});
test('读取20条原生快捷回复后可勾选其中5条，保存后仅按选中顺序发送',async()=>{
  const h=harness({config:{explainOn:false,comments:[],commentMins:0.5,jitter:0}});
  quickReplyFixture(h,Array.from({length:20},(_,i)=>'网页话术'+i));
  const reading=h.api.readQuickReplies();await h.advance(1000);await reading;
  assert.equal(h.api.quick.length,20);assert.equal(h.sent,0);
  for(const i of [0,3,5,9,10])h.quickPicks[i].checked=true;
  h.elements.get('__reply_list').onchange();h.elements.get('__save').onclick();
  assert.deepEqual(Array.from(h.api.cfg.comments),[0,3,5,9,10].map(i=>'网页话术'+i));
  assert.equal(h.elements.has('__clist'),false);h.api.start();await h.advance(40000);
  assert.deepEqual(h.sentTexts,['网页话术0','网页话术3']);await h.close();
});

test('网页弹窗可见时评论暂缓，关闭后继续正常周期',async()=>{
  const h=harness({config:{explainOn:false,comments:['甲'],commentMins:0.5,jitter:0}});
  const original=h.document.querySelectorAll;let open=true;
  const modal={isConnected:true,getClientRects:()=>[1],closest:()=>null};
  h.document.querySelectorAll=s=>s==='[class*="modal-show"],[class*="drawer-dialog-show"]'?(open?[modal]:[]):original(s);
  h.api.start();await h.advance(6000);assert.equal(h.sent,0);assert.match(h.api.S.jobs.comment.waiting,/网页窗口/);
  open=false;await h.advance(31000);assert.equal(h.sent,1);await h.close();
});
