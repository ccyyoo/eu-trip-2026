/* =============================================================
   app.js — 手机端 App 壳
   职责：视图切换（行程/票务/账本/更多）、日期快捷条、折叠状态管理、
        抽屉开合与焦点管理、票务聚合、凭证刷新、记一笔入口。
   说明：桌面端（>900px）所有 App 壳元素隐藏，此模块主动让出控制权，
        不改变原有侧栏布局与视觉。
   ============================================================= */
(function () {
  'use strict';

  var UI_KEY = 'eu26:ui:v1';
  var PHONE_MQ = window.matchMedia('(max-width:900px)');
  var TITLES = { days: '逐日行程', tickets: '门票 / 车票', ledger: '旅行账本', more: '更多' };

  /* 视图与现有区块的对应关系 */
  var VIEW_SECTIONS = {
    days: ['sec-days'],
    tickets: ['sec-tickets'],
    ledger: ['sec-ledger'],
    more: ['sec-todo', 'sec-route', 'sec-weather', 'sec-tips']
  };

  var uiState = {
    view: 'days',
    openDays: [],
    activeDay: null,
    ledgerTab: 'entry'
  };

  function isPhone() { return PHONE_MQ.matches; }
  function $(id) { return document.getElementById(id); }

  /* ---------- 状态持久化 ---------- */
  function loadUI() {
    try {
      var raw = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      if (typeof raw.view === 'string' && TITLES[raw.view]) uiState.view = raw.view;
      if (Array.isArray(raw.openDays)) uiState.openDays = raw.openDays.slice();
      if (typeof raw.activeDay === 'string') uiState.activeDay = raw.activeDay;
      if (typeof raw.ledgerTab === 'string') uiState.ledgerTab = raw.ledgerTab;
      return true;
    } catch (e) {
      return false;
    }
  }
  function saveUI() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        view: uiState.view,
        openDays: uiState.openDays,
        activeDay: uiState.activeDay,
        ledgerTab: uiState.ledgerTab
      }));
    } catch (e) { /* 无痕模式等场景静默降级 */ }
  }

  /* ---------- 折叠状态 ---------- */
  function isOpen(id) { return uiState.openDays.indexOf(id) >= 0; }

  function toggleDay(id) {
    var idx = uiState.openDays.indexOf(id);
    if (idx >= 0) {
      uiState.openDays.splice(idx, 1);
    } else {
      if (isPhone()) uiState.openDays = [];       // 手机端单开：先看当天，再看细节
      uiState.openDays.push(id);
    }
    uiState.activeDay = id;
    saveUI();
    syncDayState();
  }

  function defaultOpenDays() {
    if (!isPhone()) return (window.DAYS || []).map(function (d) { return d.id; });
    var todayId = todayDayId();
    return todayId ? [todayId] : (window.DAYS && window.DAYS[0] ? [window.DAYS[0].id] : []);
  }

  /* 手机档只保留一天展开：桌面端存下的「12 天全展开」状态不应带进手机端 */
  function enforcePhoneSingleOpen() {
    if (!isPhone() || uiState.openDays.length <= 1) return false;
    uiState.openDays = [todayDayId() || uiState.openDays[0]];
    uiState.activeDay = uiState.openDays[0];
    saveUI();
    return true;
  }

  function todayDayId() {
    var list = window.DAYS || [];
    var now = new Date();
    var iso = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    for (var i = 0; i < list.length; i++) if (list[i].date === iso) return list[i].id;
    return null;
  }

  /* ---------- 逐日行程 ----------
     标记由 index.html 的 renderDays() 统一产出，app.js 不复制第二套模板，
     只负责「凭证填充 + 折叠状态同步」，避免两处标记将来各自漂移。 */
  function buildDays() {
    var root = $('days');
    if (!root) return;
    if (typeof window.renderDays === 'function') window.renderDays();
    refreshVault();
    syncDayState();
  }

  function syncDayState() {
    var nodes = document.querySelectorAll('.day[data-day]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var open = isOpen(el.getAttribute('data-day'));
      el.classList.toggle('collapsed', !open);
      var head = el.querySelector('.day-head');
      if (head) head.setAttribute('aria-expanded', String(open));
    }
    var chips = document.querySelectorAll('#datebar .chip');
    for (var j = 0; j < chips.length; j++) {
      chips[j].setAttribute('aria-selected', String(chips[j].getAttribute('data-day') === uiState.activeDay));
    }
  }

  /* ---------- 凭证（口令解锁后填充，不重建 DOM） ---------- */
  function lockPlaceholder() {
    return '<button class="vault-empty" type="button" onclick="openQrModal()">🔒 <b>凭证已锁定</b> · 点击输入口令解锁</button>';
  }
  function refreshVault() {
    var boxes = document.querySelectorAll('.vault[data-day]');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var id = box.getAttribute('data-day');
      var html = '';
      if (window.qrUnlocked) {
        var locked = window.LOCKED && window.LOCKED[id];
        var qrs = window.QR_SLOTS && window.QR_SLOTS[id];
        if (locked) {
          html += '<div class="locked"><div class="locked-title">🔒 已锁定</div>' +
            locked.map(function (l) {
              return '<div class="locked-row"><span class="locked-cat">' + l.cat + '</span><span class="locked-val">' + l.val + '</span></div>';
            }).join('') + '</div>';
        }
        if (qrs) html += window.qrBlock(qrs);
      } else {
        var has = (window.LOCKED && window.LOCKED[id]) || (window.QR_SLOTS && window.QR_SLOTS[id]);
        if (!has) { box.innerHTML = ''; box.hidden = true; continue; }
        html = lockPlaceholder();
      }
      box.hidden = !html;
      box.innerHTML = html;
    }
    buildTickets();
  }

  /* ---------- 票务视图 ---------- */
  function buildTickets() {
    var root = $('tickets-root');
    if (!root) return;
    var groups = [];
    (window.DAYS || []).forEach(function (d) {
      var items = [];
      var qrs = window.QR_SLOTS && window.QR_SLOTS[d.id];
      if (qrs) qrs.forEach(function (q) { items.push({ name: q.label, note: q.name + (q.note ? ' · ' + q.note : '') }); });
      var locked = window.LOCKED && window.LOCKED[d.id];
      if (locked) locked.forEach(function (l) { items.push({ name: l.cat, note: l.val }); });
      if (items.length) groups.push({ d: d, items: items });
    });

    if (!groups.length) {
      root.innerHTML = '<div class="tickets-card">暂无凭证信息</div>';
      return;
    }

    root.innerHTML = groups.map(function (g) {
      var state = window.qrUnlocked
        ? '<span class="tk-state-ok">已解锁</span>'
        : '<span class="tk-state">🔒 未解锁</span>';
      return '' +
        '<div class="tickets-card">' +
          '<div class="tickets-day">' + g.d.dateLabel + ' · ' + g.d.city + ' ' + state + '</div>' +
          '<div class="tickets-sub">' + g.items.length + ' 项凭证</div>' +
          '<div class="tickets-list">' +
            g.items.map(function (it) {
              return '<button class="ticket-row" type="button" data-ticket-day="' + g.d.id + '">' +
                '<span><span class="tk-name">' + it.name + '</span><span class="tk-note">' + it.note + '</span></span>' +
                '</button>';
            }).join('') +
          '</div>' +
        '</div>';
    }).join('');
  }

  function onTicketClick(dayId) {
    if (!window.qrUnlocked) { window.openQrModal(); return; }
    setView('days');
    uiState.openDays = [dayId];
    uiState.activeDay = dayId;
    saveUI();
    syncDayState();
    scrollToDay(dayId);
  }

  /* ---------- 日期条 ---------- */
  function buildDatebar() {
    var bar = $('datebar');
    if (!bar) return;
    var labels = ['日', '一', '二', '三', '四', '五', '六'];
    bar.innerHTML = (window.DAYS || []).map(function (d) {
      var parts = (d.dateLabel || '').match(/(\d+)月(\d+)日\s*周(\S)/);
      var num = parts ? parts[2] : d.date.slice(5).replace('-', '/');
      var wk = parts ? '周' + parts[3] : labels[new Date(d.date + 'T12:00:00').getDay()];
      return '<button class="chip" type="button" role="tab" data-day="' + d.id + '" aria-selected="false">' + num + '<span>' + wk + '</span></button>';
    }).join('');
  }

  function scrollToDay(id) {
    var el = document.querySelector('.day[data-day="' + id + '"]');
    if (!el) return;
    var bar = $('appbar'), datebar = $('datebar');
    var offset = (bar ? bar.offsetHeight : 0) + (datebar ? datebar.offsetHeight : 0) + 8;
    var top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' });
    var chip = document.querySelector('#datebar .chip[data-day="' + id + '"]');
    if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  /* ---------- 视图切换 ---------- */
  function setView(view, opts) {
    if (!TITLES[view]) view = 'days';
    uiState.view = view;
    if (!(opts && opts.skipSave)) saveUI();
    applyView();
  }

  function applyView() {
    var phone = isPhone();
    Object.keys(VIEW_SECTIONS).forEach(function (name) {
      VIEW_SECTIONS[name].forEach(function (id) {
        var el = $(id);
        if (el) el.hidden = phone && name !== uiState.view;
      });
    });
    var hero = document.querySelector('.hero');
    if (hero) hero.hidden = phone && uiState.view !== 'days';
    document.body.setAttribute('data-view', uiState.view);

    var title = $('appbar-title');
    if (title) title.textContent = TITLES[uiState.view];

    var tabs = document.querySelectorAll('.tab[data-nav-tab]');
    for (var i = 0; i < tabs.length; i++) {
      var active = tabs[i].getAttribute('data-nav-tab') === uiState.view;
      if (active) tabs[i].setAttribute('aria-current', 'page');
      else tabs[i].removeAttribute('aria-current');
    }

    if (window.Ledger && window.Ledger.render) window.Ledger.render();
    if (window.highlightNav) window.highlightNav();
  }

  /* ---------- 抽屉 ---------- */
  var lastFocus = null;
  function openDrawer() {
    var sb = $('sidebar'), bd = $('sidebar-backdrop'), btn = $('appbar-menu');
    if (!sb) return;
    lastFocus = document.activeElement;
    sb.classList.add('open');
    if (bd) bd.classList.add('show');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    sb.setAttribute('aria-modal', 'true');
    var first = sb.querySelector('.sidebar-nav a');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }
  function closeDrawer() {
    var sb = $('sidebar'), bd = $('sidebar-backdrop'), btn = $('appbar-menu');
    if (!sb || !sb.classList.contains('open')) return;
    sb.classList.remove('open');
    if (bd) bd.classList.remove('show');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    var back = (lastFocus && document.contains(lastFocus)) ? lastFocus : btn;
    if (back && back.focus) back.focus();
  }
  function drawerOpen() {
    var sb = $('sidebar');
    return !!(sb && sb.classList.contains('open'));
  }

  /* ---------- 初始化 ---------- */
  function navTargetView(href) {
    if (href === '#sec-ledger') return 'ledger';
    if (href === '#sec-tickets') return 'tickets';
    if (href === '#sec-days') return 'days';
    return 'more';
  }

  function init() {
    var hadState = loadUI();

    /* 桌面端保持原语义「12 天全部展开」：不沿用手机端存下的单开状态，
       否则从手机切回桌面会看到 11 天是折叠的，属于退化。 */
    if (!isPhone()) uiState.openDays = (window.DAYS || []).map(function (d) { return d.id; });

    buildDatebar();
    buildDays();
    var needDefault = !hadState || !uiState.openDays.length;
    var enforced = enforcePhoneSingleOpen();
    if (needDefault || enforced) {
      uiState.openDays = defaultOpenDays();
      var firstId = uiState.openDays[0];
      if (!uiState.activeDay) uiState.activeDay = firstId || null;
      saveUI();
      syncDayState();
    }
    applyView();

    /* 折叠：事件委托，键盘与指针一致 */
    var days = $('days');
    if (days) {
      days.addEventListener('click', function (e) {
        var head = e.target.closest ? e.target.closest('.day-head') : null;
        if (!head) return;
        var id = head.getAttribute('data-day-toggle');
        if (id) { toggleDay(id); uiState.activeDay = id; saveUI(); }
      });
    }

    /* 底部导航 */
    var tabbar = $('tabbar');
    if (tabbar) {
      tabbar.addEventListener('click', function (e) {
        var tab = e.target.closest ? e.target.closest('.tab[data-nav-tab]') : null;
        if (!tab) return;
        var view = tab.getAttribute('data-nav-tab');
        if (view === 'more') { setView('more'); openDrawer(); return; }
        setView(view);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    /* 日期条 */
    var bar = $('datebar');
    if (bar) {
      bar.addEventListener('click', function (e) {
        var chip = e.target.closest ? e.target.closest('.chip[data-day]') : null;
        if (!chip) return;
        var id = chip.getAttribute('data-day');
        uiState.openDays = [id];
        uiState.activeDay = id;
        saveUI();
        syncDayState();
        scrollToDay(id);
      });
      bar.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var chips = Array.prototype.slice.call(bar.querySelectorAll('.chip'));
        var cur = chips.indexOf(document.activeElement);
        if (cur < 0) return;
        var next = e.key === 'ArrowRight' ? Math.min(cur + 1, chips.length - 1) : Math.max(cur - 1, 0);
        chips[next].focus();
        e.preventDefault();
      });
    }

    /* 票务 */
    var tickets = $('tickets-root');
    if (tickets) {
      tickets.addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('[data-ticket-day]') : null;
        if (row) onTicketClick(row.getAttribute('data-ticket-day'));
      });
    }

    /* 抽屉与顶部菜单 */
    var menu = $('appbar-menu');
    if (menu) menu.addEventListener('click', function () { drawerOpen() ? closeDrawer() : openDrawer(); });
    var backdrop = $('sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', function () { closeDrawer(); });
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.addEventListener('click', function () {
        var href = a.getAttribute('href') || '';
        if (isPhone()) {
          setView(navTargetView(href));
          if (href.slice(1) && $(href.slice(1))) {
            /* 视图内定位交给浏览器锚点，仅关闭抽屉 */
          }
          closeDrawer();
        }
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawerOpen()) closeDrawer();
    });

    /* 记一笔 */
    var fab = $('fab-add');
    if (fab) fab.addEventListener('click', function () {
      if (window.Ledger && window.Ledger.openEntry) window.Ledger.openEntry(uiState.activeDay);
    });

    /* 同步状态与视口变化 */
    var syncBtn = $('sync-indicator');
    if (syncBtn) syncBtn.addEventListener('click', function () {
      if (window.Ledger && window.Ledger.showStorageInfo) window.Ledger.showStorageInfo();
    });
    if (window.Ledger && window.Ledger.updateStatus) window.Ledger.updateStatus();

    /* 视口跨过 900px 断点时（旋转 / 窗口缩放）：进入手机档收敛为单开，
       避免桌面端「12 天全展开」的状态被带进手机端后页面过长。 */
    var onChange = function () {
      if (enforcePhoneSingleOpen()) syncDayState();
      applyView();
    };
    if (PHONE_MQ.addEventListener) PHONE_MQ.addEventListener('change', onChange);
    else if (PHONE_MQ.addListener) PHONE_MQ.addListener(onChange);

    window.addEventListener('scroll', function () {
      if (window.highlightNav) window.highlightNav();
    }, { passive: true });
  }

  /* 供 index.html 与其它模块调用 */
  window.App = {
    init: init,
    setView: setView,
    refreshVault: refreshVault,
    buildDays: buildDays,
    syncDayState: syncDayState,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    toggleDay: toggleDay,
    todayDayId: todayDayId,
    state: uiState,
    save: saveUI,
    isPhone: isPhone
  };
  window.refreshVault = refreshVault;
  window.openDrawer = openDrawer;
  window.closeDrawer = closeDrawer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
