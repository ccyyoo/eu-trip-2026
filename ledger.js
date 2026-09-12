/* =============================================================
   ledger.js — 旅行账本（本地版）
   数据全部保存在本机 localStorage；支持导出 JSON/CSV 与合并导入。
   金额统一用整数「分」为唯一真值，浮点只出现在输入与显示边界。
   均摊与结算语义参考 do-tongxue/Travel-Plan-Page（MIT）公开规范，
   本文件为独立实现。
   ============================================================= */
(function () {
  'use strict';

  var STORE_KEY = 'eu26:ledger:v1';
  var BACKUP_KEY = 'eu26:ledger:backup:v1';
  var UI_KEY = 'eu26:ui:v1';
  var TRIP_ID = 'eu2026';
  var VERSION = 1;

  var CATEGORIES = ['餐饮', '交通', '住宿', '门票', '购物', '其他'];
  var SYMBOL = { CNY: '¥', EUR: '€', CHF: 'CHF ', GBP: '£', HKD: 'HK$' };
  var BASE = 'CNY';

  var DEFAULT_SETTINGS = {
    baseCurrency: BASE,
    currencies: ['CNY', 'EUR', 'CHF'],
    lastCurrency: 'EUR',
    fxPresets: { EUR: 7.85, CHF: 8.9, GBP: 9.2, HKD: 0.92 }
  };

  /* ---------------- 基础工具 ---------------- */
  function uuid(prefix) {
    var s;
    if (window.crypto && window.crypto.randomUUID) s = window.crypto.randomUUID();
    else s = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    return (prefix || '') + s;
  }
  function nowIso() { return new Date().toISOString(); }
  function $(id) { return document.getElementById(id); }
  function el(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function round(n) { return Math.round(n); }

  /* 金额：字符串 → 分 */
  function toCents(input) {
    if (typeof input === 'number') return round(input * 100);
    var s = String(input == null ? '' : input).replace(/,/g, '').trim();
    if (!/^(?:\d+|\d*\.\d{1,2})$/.test(s)) return NaN;
    var parts = s.split('.');
    var yuan = parseInt(parts[0] || '0', 10);
    var frac = parts[1] ? (parts[1] + '00').slice(0, 2) : '00';
    return yuan * 100 + parseInt(frac, 10);
  }
  function centsToStr(cents) {
    var neg = cents < 0;
    var v = Math.abs(Math.round(cents));
    return (neg ? '-' : '') + Math.floor(v / 100) + '.' + String(v % 100).padStart(2, '0');
  }
  function money(cents, cur) {
    return (SYMBOL[cur] || (cur + ' ')) + centsToStr(cents);
  }
  function moneyShort(cents) { return '¥' + centsToStr(cents); }

  /* 汇率：换算一次取整，结果固化到单笔 */
  function convert(amountCents, rate) { return round(amountCents * rate); }

  /* 均摊：floor + 余数按参与人顺序每人 +1 分 */
  function splitShares(totalCents, participantIds) {
    var out = {};
    var ids = participantIds || [];
    if (!ids.length) return out;
    var base = Math.floor(totalCents / ids.length);
    var rem = totalCents - base * ids.length;
    for (var i = 0; i < ids.length; i++) {
      out[ids[i]] = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
    }
    return out;
  }

  /* ---------------- 状态 ---------------- */
  /* state 在脚本解析阶段就初始化：app.js 的 applyView() 可能在账本
     自己的 DOMContentLoaded 之前调用 Ledger.render()，延迟到 init() 再赋值会让
     render 读到 null。load() 只读 localStorage，不依赖 DOM，可以提前执行。 */
  var state = load();

  function emptyState() {
    return {
      version: VERSION,
      tripId: TRIP_ID,
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      travelers: [
        /* 成员色取自同一蓝绿家族，靠明度区分：主 teal / 亮青蓝 */
        { id: 'p-yy', name: '陈圆圆', initial: '陈', color: '#0E8079', createdAt: nowIso(), updatedAt: nowIso(), deleted: false },
        { id: 'p-lm', name: '刘敏', initial: '刘', color: '#4A9BB5', createdAt: nowIso(), updatedAt: nowIso(), deleted: false }
      ],
      bills: [],
      exportedAt: null
    };
  }

  function normalize(raw) {
    var s = emptyState();
    if (!raw || typeof raw !== 'object') return s;
    if (raw.settings && typeof raw.settings === 'object') {
      s.settings = Object.assign(s.settings, raw.settings);
    }
    if (Array.isArray(raw.travelers) && raw.travelers.length) s.travelers = raw.travelers;
    if (Array.isArray(raw.bills)) s.bills = raw.bills.filter(function (b) { return b && b.id; });
    if (typeof raw.exportedAt === 'string') s.exportedAt = raw.exportedAt;
    return s;
  }

  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(STORE_KEY) || 'null'));
    } catch (e) {
      return emptyState();
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast('本机存储写入失败，请导出备份后清理浏览器空间');
      return false;
    }
  }

  function liveBills() {
    return state.bills.filter(function (b) { return !b.deleted; });
  }
  function travelerById(id) {
    var t = state.travelers.filter(function (x) { return x.id === id; })[0];
    return t || { id: id, name: '（未命名）', initial: '?', color: '#888' };
  }

  /* ---------------- 统计与结算 ---------------- */
  function computeStats() {
    var bills = liveBills();
    var total = 0, byCat = {}, byDay = {}, paid = {}, owed = {};
    state.travelers.forEach(function (t) { paid[t.id] = 0; owed[t.id] = 0; });

    bills.forEach(function (b) {
      total += b.baseAmountCents;
      byCat[b.category] = (byCat[b.category] || 0) + b.baseAmountCents;
      byDay[b.spentOn] = (byDay[b.spentOn] || 0) + b.baseAmountCents;
      if (paid[b.payerId] !== undefined) paid[b.payerId] += b.baseAmountCents;
      var shares = splitShares(b.baseAmountCents, b.participantIds);
      Object.keys(shares).forEach(function (id) {
        if (owed[id] !== undefined) owed[id] += shares[id];
      });
    });

    var people = state.travelers.map(function (t) {
      return {
        id: t.id, name: t.name, initial: t.initial, color: t.color,
        paid: paid[t.id] || 0,
        owed: owed[t.id] || 0,
        net: (paid[t.id] || 0) - (owed[t.id] || 0)
      };
    });

    var cats = Object.keys(byCat).map(function (c) { return { cat: c, amount: byCat[c] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
    var days = Object.keys(byDay).sort().map(function (d) { return { day: d, amount: byDay[d] }; });

    return { total: total, people: people, cats: cats, days: days, count: bills.length };
  }

  /* 结算：最少转账搜索；两人场景必然 0 或 1 笔 */
  function settle(people) {
    var debtors = [], creditors = [];
    people.forEach(function (p) {
      if (p.net < 0) debtors.push({ id: p.id, amount: -p.net });
      else if (p.net > 0) creditors.push({ id: p.id, amount: p.net });
    });
    var cmp = function (a, b) { return b.amount - a.amount || String(a.id).localeCompare(String(b.id)); };
    debtors.sort(cmp);
    creditors.sort(cmp);
    if (!debtors.length || !creditors.length) return [];

    var best = null;
    var memo = {};
    function dfs(ds, cs, out) {
      if (best && out.length >= best.length) return;
      var i = 0;
      while (i < ds.length && ds[i].amount === 0) i++;
      if (i >= ds.length) {
        if (!best || out.length < best.length) best = out.slice();
        return;
      }
      var d = ds[i];
      var lower = Math.max(ds.filter(function (x) { return x.amount > 0; }).length,
        cs.filter(function (x) { return x.amount > 0; }).length);
      if (best && out.length + lower - 1 >= best.length) return;

      var key = ds.map(function (x) { return x.amount; }).join(',') + '|' + cs.map(function (x) { return x.amount; }).join(',');
      if (memo[key] !== undefined && memo[key] <= out.length) return;
      memo[key] = out.length;

      for (var j = 0; j < cs.length; j++) {
        if (cs[j].amount <= 0) continue;
        var pay = Math.min(d.amount, cs[j].amount);
        var ds2 = ds.map(function (x, k) { return k === i ? { id: x.id, amount: x.amount - pay } : { id: x.id, amount: x.amount }; });
        var cs2 = cs.map(function (x, k) { return k === j ? { id: x.id, amount: x.amount - pay } : { id: x.id, amount: x.amount }; });
        dfs(ds2, cs2, out.concat([{ fromId: d.id, toId: cs[j].id, amountCents: pay }]));
        if (best && best.length === lower) break;
      }
    }
    dfs(debtors, creditors, []);
    return best || [];
  }

  /* ---------------- 账目读写 ---------------- */
  function addBill(data) {
    var now = nowIso();
    var bill = {
      id: uuid('b-'),
      tripId: TRIP_ID,
      spentOn: data.spentOn,
      category: data.category,
      currency: data.currency,
      amountCents: data.amountCents,
      baseAmountCents: data.baseAmountCents,
      fxRate: data.fxRate,
      fxSource: data.fxSource,
      payerId: data.payerId,
      participantIds: data.participantIds.slice(),
      splitMode: 'equal',
      note: data.note || '',
      createdAt: now,
      updatedAt: now,
      updatedBy: 'local',
      deleted: false,
      deletedAt: null
    };
    state.bills.push(bill);
    save();
    return bill;
  }

  function updateBill(id, data) {
    var bill = state.bills.filter(function (b) { return b.id === id; })[0];
    if (!bill) return null;
    Object.keys(data).forEach(function (k) { bill[k] = data[k]; });
    bill.updatedAt = nowIso();
    save();
    return bill;
  }

  function removeBill(id) {
    var bill = state.bills.filter(function (b) { return b.id === id; })[0];
    if (!bill) return;
    bill.deleted = true;
    bill.deletedAt = nowIso();
    bill.updatedAt = nowIso();
    save();
    toast('已删除 1 笔 · <button type="button" class="toast-act" data-undo="' + id + '">撤销</button>', 6000);
  }

  function restoreBill(id) {
    var bill = state.bills.filter(function (b) { return b.id === id; })[0];
    if (!bill) return;
    bill.deleted = false;
    bill.deletedAt = null;
    bill.updatedAt = nowIso();
    save();
    render();
  }

  /* ---------------- 导出 / 导入合并 ---------------- */
  function snapshot() {
    return {
      version: VERSION,
      tripId: TRIP_ID,
      exportedAt: nowIso(),
      settings: state.settings,
      travelers: state.travelers,
      bills: state.bills
    };
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function stamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function exportJson() {
    state.exportedAt = nowIso();
    save();
    download('eu2026-账本-' + stamp() + '.json', JSON.stringify(snapshot(), null, 2), 'application/json');
  }
  function exportCsv() {
    var head = ['日期', '分类', '币种', '原币金额', '汇率', '人民币金额', '付款人', '分摊人', '备注'];
    var rows = liveBills().slice().sort(function (a, b) { return a.spentOn < b.spentOn ? -1 : 1; }).map(function (b) {
      return [
        b.spentOn, b.category, b.currency, centsToStr(b.amountCents),
        b.currency === BASE ? '' : String(b.fxRate),
        centsToStr(b.baseAmountCents),
        travelerById(b.payerId).name,
        b.participantIds.map(function (id) { return travelerById(id).name; }).join('/'),
        b.note || ''
      ];
    });
    var cell = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    var csv = [head].concat(rows).map(function (r) { return r.map(cell).join(','); }).join('\r\n');
    download('eu2026-账本-' + stamp() + '.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
  }

  /* 金额是一个整体事实：币种、原币金额、汇率、折合人民币四者互相推导，
     拆成四条独立冲突会让用户只改其中一条，造出「€250 折 ¥785」这种自相矛盾的记录。
     因此按「一个事实一组」划分冲突单元，一次选择整组生效。 */
  var MERGE_GROUPS = [
    { fields: ['currency', 'amountCents', 'fxRate', 'baseAmountCents'], label: '金额' },
    { fields: ['spentOn'], label: '日期' },
    { fields: ['category'], label: '分类' },
    { fields: ['payerId'], label: '付款人' },
    { fields: ['participantIds'], label: '分摊人' },
    { fields: ['note'], label: '备注' },
    { fields: ['deleted'], label: '删除状态' }
  ];

  /* 合并的核心逻辑只吃普通对象，不碰 FileReader。
     这样既能在浏览器里被程序化调用（自动化测试、将来的云端同步），
     也让「读文件」和「合并」两件事各自只负责一件事。 */
  function mergeObject(incoming, onDone) {
    var inBills = (incoming && Array.isArray(incoming.bills)) ? incoming.bills : null;
    if (!inBills) { toast('文件里没有找到账单数据'); return null; }

    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot())); } catch (e) { /* 忽略 */ }

    var conflicts = [];
    var added = 0, merged = 0;
    inBills.forEach(function (ib) {
      if (!ib || !ib.id) return;
      var mine = state.bills.filter(function (b) { return b.id === ib.id; })[0];
      if (!mine) { state.bills.push(ib); added++; return; }
      var billConflicts = [];
      MERGE_GROUPS.forEach(function (g) {
        var diffs = g.fields.filter(function (f) {
          return JSON.stringify(mine[f]) !== JSON.stringify(ib[f]);
        });
        if (!diffs.length) return;
        var mineVals = {}, theirsVals = {};
        g.fields.forEach(function (f) { mineVals[f] = mine[f]; theirsVals[f] = ib[f]; });
        billConflicts.push({
          billId: mine.id, label: g.label, diffs: diffs,
          mine: mineVals, theirs: theirsVals,
          theirsAt: ib.updatedAt || '', mineAt: mine.updatedAt || ''
        });
      });
      /* 只有真的产生了分歧才算「更新」，两边完全一致的账不计入 */
      if (billConflicts.length) { merged++; conflicts = conflicts.concat(billConflicts); }
    });

    /* 合并对方账本里的成员（不覆盖本机已有成员） */
    if (Array.isArray(incoming.travelers)) {
      incoming.travelers.forEach(function (t) {
        if (!t || !t.id) return;
        if (!state.travelers.some(function (x) { return x.id === t.id; })) state.travelers.push(t);
      });
    }

    save();
    render();
    var result = { added: added, merged: merged, conflicts: conflicts };
    if (conflicts.length) openConflicts(conflicts, added, merged);
    else toast('合并完成：新增 ' + added + ' 笔' + (merged ? '，更新 ' + merged + ' 笔' : ''));
    if (onDone) onDone(result);
    return result;
  }

  function importMerge(file, onDone) {
    var reader = new FileReader();
    reader.onload = function () {
      var incoming;
      try {
        incoming = JSON.parse(String(reader.result));
      } catch (e) {
        toast('文件解析失败：不是有效的账本 JSON');
        return;
      }
      mergeObject(incoming, onDone);
    };
    reader.readAsText(file);
  }

  function rollbackImport() {
    try {
      var raw = localStorage.getItem(BACKUP_KEY);
      if (!raw) { toast('没有可回滚的备份'); return; }
      state = normalize(JSON.parse(raw));
      save();
      render();
      toast('已回滚到导入前的数据');
    } catch (e) {
      toast('回滚失败');
    }
  }

  /* ---------------- 冲突处理 UI ---------------- */
  function showValue(field, value) {
    if (field === 'amountCents' || field === 'baseAmountCents') return centsToStr(value);
    if (field === 'payerId') return travelerById(value).name || value;
    if (field === 'participantIds') return (value || []).map(function (id) { return travelerById(id).name; }).join('/');
    if (field === 'deleted') return value ? '已删除' : '未删除';
    if (value == null || value === '') return '（空）';
    return String(value);
  }

  /* 金额组要整行读成一句话：「€100.00 × 7.85 = ¥785.00」，
     否则用户看四个裸数字根本判断不出该选哪边。 */
  function groupText(vals) {
    if (!vals) return '';
    var cur = vals.currency || '';
    var amt = SYMBOL[cur] ? SYMBOL[cur] : cur + ' ';
    return amt + centsToStr(vals.amountCents) +
      ' × ' + (vals.fxRate == null ? '—' : vals.fxRate) +
      ' = ¥' + centsToStr(vals.baseAmountCents);
  }

  function sideText(c, side) {
    var vals = side === 'mine' ? c.mine : c.theirs;
    if (c.label === '金额') return groupText(vals);
    /* 非金额组是单字段，取组内唯一的那个字段来展示 */
    var f = (c.diffs && c.diffs.length ? c.diffs : Object.keys(vals))[0];
    return showValue(f, vals[f]);
  }

  function openConflicts(conflicts, added, merged) {
    var box = $('lg-conflicts');
    $('lg-conflict-body').innerHTML =
      '<p class="lg-hint">对方的账本与本机有 ' + conflicts.length + ' 处不同。请逐项选择，不会被静默覆盖。</p>' +
      conflicts.map(function (c, i) {
        var payer = travelerById(
          (state.bills.filter(function (b) { return b.id === c.billId; })[0] || {}).payerId
        ).name || '';
        return '<div class="lg-conflict">' +
          '<div class="lg-conflict-t">' + esc(payer) + ' · ' + esc(c.label) + '</div>' +
          '<div class="lg-conflict-row"><span class="lg-cf-lbl">本机</span><span class="lg-cf-val">' + esc(sideText(c, 'mine')) + '</span>' +
          '<button type="button" class="lg-mini" data-cf="' + i + '" data-pick="mine">采用本机</button></div>' +
          '<div class="lg-conflict-row"><span class="lg-cf-lbl">对方</span><span class="lg-cf-val">' + esc(sideText(c, 'theirs')) + '</span>' +
          '<button type="button" class="lg-mini" data-cf="' + i + '" data-pick="theirs">采用对方</button></div>' +
        '</div>';
      }).join('');
    box.dataset.conflicts = JSON.stringify(conflicts);
    box.dataset.summary = '新增 ' + added + ' 笔 · 更新 ' + merged + ' 笔';
    box.classList.add('show');
  }

  function applyConflictPick(index, pick) {
    var box = $('lg-conflicts');
    var conflicts = JSON.parse(box.dataset.conflicts || '[]');
    var c = conflicts[index];
    if (!c) return;
    var bill = state.bills.filter(function (b) { return b.id === c.billId; })[0];
    if (bill) {
      /* 整组字段一起写入：金额组若只写一半，账目就会自相矛盾 */
      var vals = pick === 'mine' ? c.mine : c.theirs;
      Object.keys(vals).forEach(function (f) { bill[f] = vals[f]; });
      bill.updatedAt = nowIso();
    }
    save();
    var card = box.querySelectorAll('.lg-conflict')[index];
    if (card) {
      card.classList.add('resolved');
      card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    }
    render();
    toast('已采用' + (pick === 'mine' ? '本机' : '对方') + '的' + c.label + '值');
  }

  /* ---------------- 提示条 ---------------- */
  var toastTimer = null;
  function toast(html, ms) {
    var t = $('lg-toast');
    if (!t) return;
    t.innerHTML = html;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 3200);
  }

  /* ---------------- 记一笔表单 ---------------- */
  var draft = null;

  function defaultSpentOn(dayId) {
    var days = window.DAYS || [];
    var hit = days.filter(function (d) { return d.id === dayId; })[0];
    if (hit) return hit.date;
    var today = (window.App && window.App.todayDayId) ? window.App.todayDayId() : null;
    var t = days.filter(function (d) { return d.id === today; })[0];
    if (t) return t.date;
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }

  function newDraft(dayId) {
    return {
      id: null,
      spentOn: defaultSpentOn(dayId),
      category: '餐饮',
      currency: state.settings.lastCurrency || 'EUR',
      amount: '',
      fxMode: 'rate',
      rate: state.settings.fxPresets[state.settings.lastCurrency || 'EUR'] || 7.85,
      base: '',
      payerId: state.travelers[0] ? state.travelers[0].id : 'p-yy',
      participantIds: state.travelers.map(function (t) { return t.id; }),
      note: ''
    };
  }

  function draftFrom(bill) {
    return {
      id: bill.id,
      spentOn: bill.spentOn,
      category: bill.category,
      currency: bill.currency,
      amount: centsToStr(bill.amountCents),
      fxMode: 'rate',
      rate: bill.currency === BASE ? 1 : bill.fxRate,
      base: centsToStr(bill.baseAmountCents),
      payerId: bill.payerId,
      participantIds: bill.participantIds.slice(),
      note: bill.note || ''
    };
  }

  function draftBase() {
    var c = toCents(draft.amount);
    if (isNaN(c)) return NaN;
    if (draft.currency === BASE) return c;
    if (draft.fxMode === 'rate') {
      var r = parseFloat(draft.rate);
      if (!r || r <= 0) return NaN;
      return convert(c, r);
    }
    var b = toCents(draft.base);
    return isNaN(b) ? NaN : b;
  }

  function formMarkup() {
    var t = state.travelers;
    var cats = CATEGORIES.map(function (c) {
      return '<button type="button" class="lg-chip' + (draft.category === c ? ' on' : '') + '" data-cat="' + c + '">' + c + '</button>';
    }).join('');
    var cur = state.settings.currencies.map(function (c) {
      return '<button type="button" class="lg-chip' + (draft.currency === c ? ' on' : '') + '" data-cur="' + c + '">' + (SYMBOL[c] || c) + ' ' + c + '</button>';
    }).join('');
    var payer = t.map(function (p) {
      return '<button type="button" class="lg-person' + (draft.payerId === p.id ? ' on' : '') + '" data-payer="' + p.id + '">' +
        '<span class="lg-av" style="background:' + p.color + '">' + p.initial + '</span>' + esc(p.name) + '</button>';
    }).join('');
    var parts = t.map(function (p) {
      return '<button type="button" class="lg-person' + (draft.participantIds.indexOf(p.id) >= 0 ? ' on' : '') + '" data-part="' + p.id + '">' +
        '<span class="lg-av" style="background:' + p.color + '">' + p.initial + '</span>' + esc(p.name) + '</button>';
    }).join('');

    var fxRow = '';
    if (draft.currency !== BASE) {
      var baseCents = draftBase();
      fxRow = '<div class="lg-fx">' +
        '<div class="lg-fx-line">折合人民币：<b>' + (isNaN(baseCents) ? '—' : moneyShort(baseCents)) + '</b></div>' +
        '<div class="lg-fx-edit">' +
          '<label>汇率 1 ' + draft.currency + ' =' +
            '<input type="number" step="0.0001" min="0" id="lg-rate" value="' + draft.rate + '" inputmode="decimal"> CNY</label>' +
          '<label>或直接填人民币金额' +
            '<input type="number" step="0.01" min="0" id="lg-base" value="' + (draft.fxMode === 'base' ? draft.base : '') + '" inputmode="decimal"></label>' +
        '</div>' +
        '<div class="lg-hint">汇率会按这笔账固化保存，之后修改默认汇率不会影响历史账目。</div>' +
      '</div>';
    } else {
      fxRow = '<div class="lg-hint">本币记账，金额直接计入人民币。</div>';
    }

    /* .lg-share 容器必须常驻：只刷新内容的 refreshFxOnly() 依赖它已存在，
       否则首次打开（金额为空）时不会生成，之后输入金额也就永远不显示。 */
    var shareHtml = '';
    var bc = draftBase();
    if (!isNaN(bc) && draft.participantIds.length) {
      var shares = splitShares(bc, draft.participantIds);
      shareHtml = draft.participantIds.map(function (id) {
        return esc(travelerById(id).name) + ' ' + moneyShort(shares[id]);
      }).join(' · ');
    }
    var shareLine = '<div class="lg-share">' + shareHtml + '</div>';

    return '' +
      '<div class="lg-field">' +
        '<label class="lg-lbl" for="lg-amount">金额</label>' +
        '<input class="lg-amount" id="lg-amount" type="text" inputmode="decimal" placeholder="0.00" value="' + esc(draft.amount) + '">' +
        '<div class="lg-chips">' + cur + '</div>' +
      '</div>' +
      fxRow +
      '<div class="lg-field"><div class="lg-lbl">分类</div><div class="lg-chips">' + cats + '</div></div>' +
      '<div class="lg-field"><div class="lg-lbl">付款人</div><div class="lg-persons">' + payer + '</div></div>' +
      '<div class="lg-field"><div class="lg-lbl">分摊人</div><div class="lg-persons">' + parts + '</div>' + shareLine + '</div>' +
      '<div class="lg-field"><label class="lg-lbl" for="lg-date">日期</label>' +
        '<input class="lg-date" id="lg-date" type="date" value="' + esc(draft.spentOn) + '"></div>' +
      '<div class="lg-field"><label class="lg-lbl" for="lg-note">备注</label>' +
        '<input class="lg-input" id="lg-note" type="text" maxlength="160" placeholder="可选" value="' + esc(draft.note) + '"></div>' +
      '<div class="lg-form-actions">' +
        '<button type="button" class="lg-btn" data-act="cancel">取消</button>' +
        '<button type="button" class="lg-btn lg-btn-primary" data-act="save">' + (draft.id ? '保存修改' : '保存') + '</button>' +
      '</div>';
  }

  function openEntry(dayId) {
    draft = newDraft(dayId);
    showSheet('记一笔');
  }
  function openEdit(id) {
    var bill = state.bills.filter(function (b) { return b.id === id; })[0];
    if (!bill) return;
    draft = draftFrom(bill);
    showSheet('编辑账目');
  }

  function showSheet(title) {
    var sheet = $('lg-sheet');
    $('lg-sheet-title').textContent = title;
    $('lg-sheet-body').innerHTML = formMarkup();
    sheet.classList.add('show');
    var amount = $('lg-amount');
    if (amount) setTimeout(function () { amount.focus(); }, 80);
  }
  function closeSheet() {
    var sheet = $('lg-sheet');
    if (sheet) sheet.classList.remove('show');
  }

  function refreshSheet() {
    var body = $('lg-sheet-body');
    if (!body) return;
    var active = document.activeElement;
    var id = active && active.id;
    body.innerHTML = formMarkup();
    if (id) {
      var again = $(id);
      if (again && again.focus) { again.focus(); if (again.setSelectionRange && again.value) again.setSelectionRange(again.value.length, again.value.length); }
    }
  }

  function saveDraft() {
    var cents = toCents(draft.amount);
    if (isNaN(cents) || cents <= 0) { toast('请填写正确的金额'); return; }
    if (!draft.participantIds.length) { toast('至少选择 1 位分摊人'); return; }
    var baseCents = draftBase();
    if (isNaN(baseCents) || baseCents < 0) { toast('请填写正确的汇率或人民币金额'); return; }

    var rate = draft.currency === BASE ? 1 : (draft.fxMode === 'rate'
      ? parseFloat(draft.rate)
      : Math.round((baseCents / cents) * 10000) / 10000);

    var payload = {
      spentOn: draft.spentOn,
      category: draft.category,
      currency: draft.currency,
      amountCents: cents,
      baseAmountCents: baseCents,
      fxRate: rate,
      fxSource: draft.currency === BASE ? 'none' : (draft.fxMode === 'rate' ? 'manual' : 'derived'),
      payerId: draft.payerId,
      participantIds: draft.participantIds.slice(),
      note: (draft.note || '').trim()
    };

    state.settings.lastCurrency = draft.currency;
    if (draft.currency !== BASE && draft.fxMode === 'rate') {
      state.settings.fxPresets[draft.currency] = rate;
    }

    if (draft.id) updateBill(draft.id, payload);
    else addBill(payload);
    save();
    closeSheet();
    render();
    toast(draft.id ? '已保存修改' : '已记录 ' + money(cents, draft.currency) + '（' + moneyShort(baseCents) + '）');
  }

  /* ---------------- 面板渲染 ---------------- */
  function tabsMarkup(active) {
    var tabs = [['entry', '记一笔'], ['list', '明细'], ['settle', '结算'], ['stats', '统计']];
    return '<div class="lg-tabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" class="lg-tab' + (active === t[0] ? ' on' : '') + '" role="tab" aria-selected="' + (active === t[0]) + '" data-lg-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }

  function panelList() {
    var bills = liveBills().slice().sort(function (a, b) {
      return a.spentOn === b.spentOn ? (a.createdAt < b.createdAt ? 1 : -1) : (a.spentOn < b.spentOn ? 1 : -1);
    });
    if (!bills.length) {
      return '<div class="lg-empty">还没有账目。点「记一笔」，或直接点右下角的按钮。</div>';
    }
    var byDay = {};
    bills.forEach(function (b) { (byDay[b.spentOn] = byDay[b.spentOn] || []).push(b); });
    return Object.keys(byDay).sort().reverse().map(function (day) {
      var sum = byDay[day].reduce(function (a, b) { return a + b.baseAmountCents; }, 0);
      return '<div class="lg-day">' +
        '<div class="lg-day-h"><span>' + esc(day) + '</span><span>' + moneyShort(sum) + '</span></div>' +
        byDay[day].map(function (b) {
          var others = b.participantIds.filter(function (id) { return id !== b.payerId; });
          var label = others.length
            ? travelerById(b.payerId).name + '付 · ' + b.participantIds.length + '人分摊'
            : travelerById(b.payerId).name + '付 · 个人';
          return '<div class="lg-row">' +
            '<div class="lg-row-main">' +
              '<div class="lg-row-t">' + esc(b.category) + (b.note ? ' · ' + esc(b.note) : '') + '</div>' +
              '<div class="lg-row-s">' + esc(label) + (b.currency === BASE ? '' : ' · 1 ' + b.currency + '=' + b.fxRate) + '</div>' +
            '</div>' +
            '<div class="lg-row-amt">' +
              '<div class="lg-amt-b">' + moneyShort(b.baseAmountCents) + '</div>' +
              (b.currency === BASE ? '' : '<div class="lg-amt-o">' + money(b.amountCents, b.currency) + '</div>') +
            '</div>' +
            '<div class="lg-row-act">' +
              '<button type="button" class="lg-mini" data-edit="' + b.id + '">编辑</button>' +
              '<button type="button" class="lg-mini lg-mini-danger" data-del="' + b.id + '">删除</button>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }).join('');
  }

  function panelSettle() {
    var s = computeStats();
    if (!s.count) return '<div class="lg-empty">还没有账目，无法结算。</div>';
    var transfers = settle(s.people);
    return '' +
      '<div class="lg-total"><div class="lg-total-l">旅行总花费（折合人民币）</div>' +
        '<div class="lg-total-v">' + moneyShort(s.total) + '</div>' +
        '<div class="lg-total-s">共 ' + s.count + ' 笔 · ' + s.people.length + ' 人分摊</div></div>' +
      '<div class="lg-people">' + s.people.map(function (p) {
        var cls = p.net > 0 ? 'pos' : (p.net < 0 ? 'neg' : '');
        var txt = p.net > 0 ? '应收 ' + moneyShort(p.net) : (p.net < 0 ? '应付 ' + moneyShort(-p.net) : '已平');
        return '<div class="lg-person-card">' +
          '<span class="lg-av" style="background:' + p.color + '">' + p.initial + '</span>' +
          '<div class="lg-person-info"><div class="lg-person-name">' + esc(p.name) + '</div>' +
          '<div class="lg-person-sub">已付 ' + moneyShort(p.paid) + ' · 应摊 ' + moneyShort(p.owed) + '</div></div>' +
          '<div class="lg-net ' + cls + '">' + txt + '</div>' +
        '</div>';
      }).join('') + '</div>' +
      '<div class="lg-settle">' +
        '<div class="lg-settle-t">建议转账</div>' +
        (transfers.length ? transfers.map(function (t) {
          return '<div class="lg-transfer">' + esc(travelerById(t.fromId).name) + ' → ' + esc(travelerById(t.toId).name) +
            ' <b>' + moneyShort(t.amountCents) + '</b></div>';
        }).join('') : '<div class="lg-hint">当前无需转账，账目已平。</div>') +
      '</div>';
  }

  function panelStats() {
    var s = computeStats();
    if (!s.count) return '<div class="lg-empty">还没有账目，暂无统计。</div>';
    var max = s.cats.length ? s.cats[0].amount : 1;
    var catBars = s.cats.map(function (c) {
      var pct = Math.round(c.amount / max * 100);
      return '<div class="lg-bar-row"><span class="lg-bar-l">' + esc(c.cat) + '</span>' +
        '<span class="lg-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="lg-bar-v">' + moneyShort(c.amount) + '</span></div>';
    }).join('');
    var dayMax = s.days.reduce(function (a, d) { return Math.max(a, d.amount); }, 1);
    var dayBars = s.days.map(function (d) {
      var pct = Math.round(d.amount / dayMax * 100);
      return '<div class="lg-bar-row"><span class="lg-bar-l">' + esc(d.day.slice(5)) + '</span>' +
        '<span class="lg-bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="lg-bar-v">' + moneyShort(d.amount) + '</span></div>';
    }).join('');
    return '<div class="lg-stat-block"><div class="lg-stat-t">按分类</div>' + catBars + '</div>' +
      '<div class="lg-stat-block"><div class="lg-stat-t">按日期</div>' + dayBars + '</div>';
  }

  function panelEntry() {
    var s = computeStats();
    return '<div class="lg-cta">' +
        '<button type="button" class="lg-btn lg-btn-primary lg-btn-lg" data-act="new">＋ 记一笔</button>' +
        '<div class="lg-hint">金额以整数分保存；外币按当笔汇率折合人民币，历史账目不受日后汇率调整影响。</div>' +
      '</div>' +
      '<div class="lg-total"><div class="lg-total-l">当前总花费</div>' +
        '<div class="lg-total-v">' + moneyShort(s.total) + '</div>' +
        '<div class="lg-total-s">共 ' + s.count + ' 笔</div></div>';
  }

  function ledgerTab() {
    return (window.App && window.App.state.ledgerTab) || 'entry';
  }

  function render() {
    var root = $('ledger-root');
    if (!root) return;
    var tab = ledgerTab();
    var panel = tab === 'list' ? panelList()
      : tab === 'settle' ? panelSettle()
      : tab === 'stats' ? panelStats()
      : panelEntry();
    root.innerHTML = tabsMarkup(tab) + '<div class="lg-panel">' + panel + '</div>' +
      '<div class="lg-tools">' +
        '<button type="button" class="lg-mini" data-act="export-json">导出 JSON</button>' +
        '<button type="button" class="lg-mini" data-act="import-json">合并导入</button>' +
        '<button type="button" class="lg-mini" data-act="export-csv">导出 CSV</button>' +
        '<button type="button" class="lg-mini" data-act="rollback">回滚导入</button>' +
      '</div>';
    updateStatus();
  }

  function setTab(tab) {
    if (window.App && window.App.state) {
      window.App.state.ledgerTab = tab;
      if (window.App.save) window.App.save();
    }
    render();
  }

  /* ---------------- 顶部同步状态（本地版语义） ---------------- */
  function updateStatus() {
    var btn = $('sync-indicator');
    if (!btn) return;
    var adapter = Sync.current();
    if (adapter.mode === 'local') {
      btn.textContent = '本机保存';
      btn.title = '账目保存在本机浏览器；可导出备份或与他人合并';
    } else {
      btn.textContent = adapter.label();
    }
  }

  function showStorageInfo() {
    var bills = liveBills().length;
    var bytes = 0;
    try { bytes = (localStorage.getItem(STORE_KEY) || '').length; } catch (e) { bytes = 0; }
    var last = state.exportedAt ? new Date(state.exportedAt).toLocaleString('zh-CN', { hour12: false }) : '还没导出过';
    toast('本机已保存 ' + bills + ' 笔账目（约 ' + Math.round(bytes / 1024) + ' KB）<br>上次导出：' + esc(last), 6000);
  }

  /* ---------------- 同步适配器（预留，本地版为空实现） ---------------- */
  var Sync = {
    adapters: {
      local: {
        mode: 'local',
        push: function () { return Promise.resolve(); },
        pull: function () { return Promise.resolve(null); },
        flush: function () { return Promise.resolve({ ok: true, mode: 'local' }); },
        label: function () { return '本机保存'; },
        status: function () { return { state: 'local', pending: 0 }; }
      }
    },
    current: function () { return Sync.adapters.local; }
  };

  /* ---------------- 自测 ---------------- */
  function selfTest() {
    var out = [];
    var eq = function (name, got, want) {
      var ok = JSON.stringify(got) === JSON.stringify(want);
      out.push((ok ? 'PASS' : 'FAIL') + ' ' + name + ' → ' + JSON.stringify(got) + (ok ? '' : '（期望 ' + JSON.stringify(want) + '）'));
      return ok;
    };
    eq('两位数平分 10000', splitShares(10000, ['A', 'B']), { A: 5000, B: 5000 });
    eq('三人均摊 1000（10.00）', splitShares(1000, ['A', 'B', 'C']), { A: 334, B: 333, C: 333 });
    eq('一人全额 10001', splitShares(10001, ['A']), { A: 10001 });
    eq('两人分 1 分不丢', splitShares(1, ['A', 'B']), { A: 1, B: 0 });
    eq('汇率换算 1235 × 7.85', convert(1235, 7.85), 9695);

    var s1 = computeStatsFor([
      { payerId: 'A', baseAmountCents: 10000, participantIds: ['A', 'B'], category: '餐饮', spentOn: '2026-09-26' },
      { payerId: 'B', baseAmountCents: 6000, participantIds: ['A', 'B'], category: '交通', spentOn: '2026-09-26' }
    ], ['A', 'B']);
    eq('交叉付款净额', s1.people.map(function (p) { return p.net; }), [2000, -2000]);
    eq('交叉付款结算笔数', settle(s1.people).length, 1);
    eq('交叉付款转账金额', settle(s1.people)[0].amountCents, 2000);

    var s2 = computeStatsFor([
      { payerId: 'A', baseAmountCents: 3000, participantIds: ['A', 'B', 'C'], category: '餐饮', spentOn: '2026-09-26' },
      { payerId: 'B', baseAmountCents: 3000, participantIds: ['A', 'B', 'C'], category: '餐饮', spentOn: '2026-09-26' },
      { payerId: 'C', baseAmountCents: 3000, participantIds: ['A', 'B', 'C'], category: '餐饮', spentOn: '2026-09-26' }
    ], ['A', 'B', 'C']);
    eq('三方各付一笔应全部打平', s2.people.map(function (p) { return p.net; }), [0, 0, 0]);
    eq('打平时转账笔数', settle(s2.people).length, 0);
    return out;
  }

  function computeStatsFor(bills, ids) {
    var paid = {}, owed = {}, total = 0;
    ids.forEach(function (i) { paid[i] = 0; owed[i] = 0; });
    bills.forEach(function (b) {
      total += b.baseAmountCents;
      paid[b.payerId] += b.baseAmountCents;
      var sh = splitShares(b.baseAmountCents, b.participantIds);
      Object.keys(sh).forEach(function (k) { owed[k] += sh[k]; });
    });
    return {
      total: total,
      people: ids.map(function (i) { return { id: i, net: paid[i] - owed[i] }; }),
      cats: [], days: [], count: bills.length
    };
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindOnce() {
    var root = $('ledger-root');
    if (root) {
      root.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('button') : null;
        if (!t) return;
        if (t.dataset.lgTab) { setTab(t.dataset.lgTab); return; }
        if (t.dataset.edit) { openEdit(t.dataset.edit); return; }
        if (t.dataset.del) { removeBill(t.dataset.del); render(); return; }
        var act = t.dataset.act;
        if (!act) return;
        if (act === 'new') openEntry(window.App ? window.App.state.activeDay : null);
        else if (act === 'export-json') exportJson();
        else if (act === 'export-csv') exportCsv();
        else if (act === 'import-json') { var f = $('lg-file'); if (f) f.click(); }
        else if (act === 'rollback') rollbackImport();
      });
    }

    var file = $('lg-file');
    if (file) file.addEventListener('change', function () {
      if (file.files && file.files[0]) importMerge(file.files[0]);
      file.value = '';
    });

    var sheet = $('lg-sheet');
    if (sheet) {
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet || (e.target.closest && e.target.closest('[data-act="close"]'))) { closeSheet(); return; }
        var t = e.target.closest ? e.target.closest('button') : null;
        if (!t || !t.dataset) return;
        if (t.dataset.cat) { draft.category = t.dataset.cat; refreshSheet(); return; }
        if (t.dataset.cur) {
          draft.currency = t.dataset.cur;
          if (draft.currency !== BASE) {
            draft.fxMode = 'rate';
            draft.rate = state.settings.fxPresets[draft.currency] || 1;
          }
          refreshSheet(); return;
        }
        if (t.dataset.payer) { draft.payerId = t.dataset.payer; refreshSheet(); return; }
        if (t.dataset.part) {
          var id = t.dataset.part;
          var i = draft.participantIds.indexOf(id);
          if (i >= 0) draft.participantIds.splice(i, 1);
          else { draft.participantIds.push(state.travelers.map(function (p) { return p.id; }).filter(function (p) { return draft.participantIds.indexOf(p) < 0 && p === id; })[0]); draft.participantIds = state.travelers.map(function (p) { return p.id; }).filter(function (p) { return draft.participantIds.indexOf(p) >= 0; }); }
          refreshSheet(); return;
        }
        if (t.dataset.act === 'cancel') { closeSheet(); return; }
        if (t.dataset.act === 'save') saveDraft();
      });

      sheet.addEventListener('input', function (e) {
        var id = e.target.id;
        if (id === 'lg-amount') { draft.amount = e.target.value; refreshFxOnly(); }
        else if (id === 'lg-rate') { draft.fxMode = 'rate'; draft.rate = e.target.value; refreshFxOnly(); }
        else if (id === 'lg-base') { draft.fxMode = 'base'; draft.base = e.target.value; refreshFxOnly(); }
        else if (id === 'lg-date') draft.spentOn = e.target.value;
        else if (id === 'lg-note') draft.note = e.target.value;
      });
      sheet.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.id === 'lg-amount') { e.preventDefault(); saveDraft(); }
      });
    }

    var conflicts = $('lg-conflicts');
    if (conflicts) {
      conflicts.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('button') : null;
        if (!t) return;
        if (t.dataset.act === 'close-conflicts') { conflicts.classList.remove('show'); return; }
        if (t.dataset.cf !== undefined && t.dataset.pick) applyConflictPick(parseInt(t.dataset.cf, 10), t.dataset.pick);
      });
    }

    var toastBox = $('lg-toast');
    if (toastBox) {
      toastBox.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-undo]') : null;
        if (t) restoreBill(t.dataset.undo);
      });
    }
  }

  /* 只刷新金额/汇率联动部分，避免输入时丢焦点 */
  function refreshFxOnly() {
    var fx = el('.lg-fx-line');
    var share = el('.lg-share');
    var base = draftBase();
    if (fx) fx.innerHTML = '折合人民币：<b>' + (isNaN(base) ? '—' : moneyShort(base)) + '</b>';
    if (share) {
      if (!isNaN(base) && draft.participantIds.length) {
        var shares = splitShares(base, draft.participantIds);
        share.innerHTML = draft.participantIds.map(function (id) {
          return esc(travelerById(id).name) + ' ' + moneyShort(shares[id]);
        }).join(' · ');
      } else {
        share.innerHTML = '';
      }
    }
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    save();
    bindOnce();
    render();
  }

  window.Ledger = {
    init: init,
    render: render,
    openEntry: openEntry,
    openEdit: openEdit,
    updateStatus: updateStatus,
    showStorageInfo: showStorageInfo,
    exportJson: exportJson,
    exportCsv: exportCsv,
    importMerge: importMerge,
    mergeObject: mergeObject,
    rollbackImport: rollbackImport,
    selfTest: selfTest,
    computeStats: computeStats,
    settle: settle,
    splitShares: splitShares,
    toCents: toCents,
    convert: convert,
    sync: Sync,
    state: function () { return state; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
