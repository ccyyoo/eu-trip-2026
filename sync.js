/* =============================================================
   sync.js — 旅行账本云同步（可插拔后端）

   为什么需要它：账目原本只存在 localStorage，而 localStorage 按
   「设备 + 浏览器」隔离 —— 电脑上记的账手机上永远看不到，两台设备
   各自记的账也没有任何通道汇合。

   设计要点：
   1. 后端做成适配器，接口与 ledger.js 预留的 Sync.adapters 对齐
      （push / pull / flush / label / status）。换后端不用碰账本逻辑。
   2. 同步 = 「拉取远端 → 用 Ledger.mergeObject 合并 → 推回远端」。
      复用账本已有的按 id + updatedAt 的冲突机制，不另写一套。
   3. 推送前一定先拉取合并：否则后推送的设备会用旧快照覆盖掉
      对方刚记的账。这条是双向同步能不能用的关键。
   4. 凭据存在 localStorage，不写进代码 —— 本仓库是公开的 GitHub
      Pages，硬编码 token 等于把它推到公网。
   ============================================================= */
(function () {
  'use strict';

  var CFG_KEY = 'eu26:sync:v1';
  var LAST_KEY = 'eu26:sync:last:v1';

  var DEFAULTS = { type: 'none', url: '', token: '', room: 'eu2026' };

  /* ---------------- 配置 ---------------- */
  function readCfg() {
    try {
      var raw = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, raw);
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }
  function writeCfg(c) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* 忽略 */ }
  }
  function lastSyncAt(v) {
    try {
      if (v === undefined) return localStorage.getItem(LAST_KEY) || '';
      if (v === null) localStorage.removeItem(LAST_KEY);
      else localStorage.setItem(LAST_KEY, v);
      return v;
    } catch (e) { return ''; }
  }

  function roomKey(c) {
    // 房间号让同一份凭据也能隔出多本账（比如明年换次旅行）
    return 'eu26:' + (c.room || 'eu2026');
  }

  /* ---------------- 网络：统一错误语义 ----------------
     fetch 只在网络层失败时 reject，HTTP 4xx/5xx 是 resolve。
     这里把两者都转成带 kind 的错误，UI 才能给出可操作的提示。 */
  function request(url, opts, timeoutMs) {
    var to = timeoutMs || 12000;
    var ctrl = null, timer = null;
    if (window.AbortController) {
      ctrl = new window.AbortController();
      timer = setTimeout(function () { ctrl.abort(); }, to);
      opts.signal = ctrl.signal;
    }
    return fetch(url, opts).then(function (r) {
      if (timer) clearTimeout(timer);
      if (r.status === 401 || r.status === 403) {
        var e1 = new Error('令牌无效或没有权限（HTTP ' + r.status + '）');
        e1.kind = 'auth'; return Promise.reject(e1);
      }
      if (r.status === 404) {
        var e2 = new Error('地址不存在（HTTP 404），检查 URL 是否填全');
        e2.kind = 'url'; return Promise.reject(e2);
      }
      if (!r.ok) {
        var e3 = new Error('服务端返回 HTTP ' + r.status);
        e3.kind = 'http'; return Promise.reject(e3);
      }
      return r.text();
    }, function (err) {
      if (timer) clearTimeout(timer);
      var e = new Error('连不上服务器：' + (err && err.message ? err.message : '网络错误'));
      /* 浏览器把 CORS 拒绝也报成 "Failed to fetch"：
         如果目标地址本身可达，八成是对方没给 CORS 头。 */
      e.kind = 'network';
      e.maybeCors = true;
      return Promise.reject(e);
    });
  }

  function parseJsonOrNull(s) {
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  /* ---------------- 后端一：Upstash Redis REST ----------------
     免费额度 50 万命令/月，免信用卡。命令以 JSON 数组作 POST body，
     避免对账本 JSON 做 URL 编码。 */
  function upstashAdapter(c) {
    var key = roomKey(c);
    function call(arr) {
      return request(c.url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + c.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(arr)
      }).then(function (txt) {
        var j = parseJsonOrNull(txt);
        if (j && j.error) {
          var e = new Error(j.error); e.kind = 'server'; return Promise.reject(e);
        }
        return j ? j.result : null;
      });
    }
    return {
      mode: 'cloud',
      label: function () { return '云同步 · Upstash'; },
      pull: function () {
        return call(['GET', key]).then(function (v) {
          if (v == null) return null;
          return typeof v === 'string' ? parseJsonOrNull(v) : v;
        });
      },
      push: function (snap) { return call(['SET', key, JSON.stringify(snap)]); },
      test: function () { return call(['PING']).then(function () { return true; }); }
    };
  }

  /* ---------------- 后端二：自建端点（Cloudflare Worker 等） ----------------
     约定：GET  ?room=xxx          取快照
          PUT  ?room=xxx  body=快照 存快照
          需自行返回 CORS 头；可选用 X-Sync-Pin 做口令校验。
     自建的好处是 CORS 自己说了算，不会遇到第三方不给跨域头的情况。 */
  function workerAdapter(c) {
    function base() {
      return c.url + (c.url.indexOf('?') >= 0 ? '&' : '?') + 'room=' + encodeURIComponent(c.room || 'eu2026');
    }
    function headers() {
      var h = { 'Content-Type': 'application/json' };
      if (c.token) h['X-Sync-Pin'] = c.token;
      return h;
    }
    return {
      mode: 'cloud',
      label: function () { return '云同步 · 自建端点'; },
      pull: function () {
        return request(base(), { method: 'GET', headers: headers() }).then(parseJsonOrNull);
      },
      push: function (snap) {
        return request(base(), {
          method: 'PUT', headers: headers(), body: JSON.stringify(snap)
        }).then(function () { return true; });
      },
      test: function () {
        return request(base(), { method: 'GET', headers: headers() }).then(function () { return true; });
      }
    };
  }

  /* ---------------- 后端三：本地（默认，不同步） ---------------- */
  var localAdapter = {
    mode: 'local',
    label: function () { return '本机保存'; },
    pull: function () { return Promise.resolve(null); },
    push: function () { return Promise.resolve(true); },
    test: function () { return Promise.resolve(false); }
  };

  function build(c) {
    if (!c || c.type === 'none' || !c.url) return localAdapter;
    if (c.type === 'upstash') return upstashAdapter(c);
    if (c.type === 'worker') return workerAdapter(c);
    return localAdapter;
  }

  /* ---------------- 同步流程 ----------------
     push 之前必先 pull：两台设备同时记时，后推的那个如果直接覆盖，
     会把对方刚记的账抹掉。先合并再推是这里唯一不能省的一步。 */
  var pending = 0, lastError = '';

  function syncNow(opts) {
    opts = opts || {};
    var c = readCfg();
    var a = build(c);
    if (a.mode === 'local') {
      return Promise.resolve({ ok: false, reason: '未配置云同步', added: 0, merged: 0 });
    }
    var L = window.Ledger;
    if (!L || typeof L.mergeObject !== 'function') {
      return Promise.resolve({ ok: false, reason: '账本模块未就绪', added: 0, merged: 0 });
    }

    pending++;
    notify();

    return a.pull().then(function (remote) {
      if (!remote || !Array.isArray(remote.bills)) {
        // 远端还是空的：把本机推上去，作为第一份
        return a.push(snapshotOf(L)).then(function () {
          lastError = '';
          lastSyncAt(new Date().toISOString());
          return { ok: true, added: 0, merged: 0, seeded: true };
        });
      }
      var res = L.mergeObject(remote, function () { /* 冲突面板由账本自己开 */ });
      // 合并完立刻回推，让对方下次拉取时拿到合并结果
      return a.push(snapshotOf(L)).then(function () {
        lastError = '';
        lastSyncAt(new Date().toISOString());
        return {
          ok: true,
          added: res ? res.added : 0,
          merged: res ? res.merged : 0,
          conflicts: res && res.conflicts ? res.conflicts.length : 0
        };
      });
    }).catch(function (e) {
      lastError = (e && e.message) || String(e);
      return { ok: false, reason: lastError, kind: (e && e.kind) || '', maybeCors: !!(e && e.maybeCors) };
    }).then(function (r) {
      pending--;
      notify();
      return r;
    });
  }

  function snapshotOf(L) {
    if (typeof L.exportJson === 'function' && L.state) {
      var s = L.state();
      return {
        version: 1, tripId: 'eu2026', exportedAt: new Date().toISOString(),
        settings: s.settings, travelers: s.travelers, bills: s.bills
      };
    }
    return null;
  }

  function testConnection(c) {
    var a = build(c);
    if (a.mode === 'local') return Promise.resolve({ ok: false, reason: '还没填地址' });
    return a.test().then(function () {
      return { ok: true };
    }, function (e) {
      return { ok: false, reason: (e && e.message) || String(e), kind: (e && e.kind) || '', maybeCors: !!(e && e.maybeCors) };
    });
  }

  /* ---------------- 邀请链接 ----------------
     让同伴加入要填三样东西（地址 / 令牌 / 房间号），口述或手打必然出错。
     所以把配置编进一条链接，对方点开就自动配好。
     用 ?join= 而不是 #join=：本页的锚点会被 checkHashUnlock 清掉，
     而 replaceState 只保留 pathname + search，query 能活到我们读取它。
     拿到之后立刻把 query 抹掉 —— 链接等同于钥匙，别让它留在地址栏和
     浏览历史里。 */
  function enc(o) {
    try {
      return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o)))));
    } catch (e) { return ''; }
  }
  function dec(s) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(s)))));
    } catch (e) { return null; }
  }
  function packCfg(c) {
    return { t: c.type, u: c.url, k: c.token, r: c.room };
  }
  function unpackCfg(o) {
    if (!o || typeof o !== 'object' || !o.u) return null;
    var t = o.t === 'upstash' || o.t === 'worker' ? o.t : 'none';
    return { type: t, url: String(o.u), token: String(o.k || ''), room: String(o.r || 'eu2026') };
  }
  function buildInvite(c, baseUrl) {
    var packed = enc(packCfg(c));
    if (!packed) return '';
    var base = baseUrl || (location.origin + location.pathname);
    return base + '?join=' + packed;
  }
  function consumeInvite() {
    var m = /[?&]join=([^&]+)/.exec(location.search || '');
    if (!m) return null;
    var cfg = unpackCfg(dec(m[1]));
    // 不管解析成功与否都清掉，免得钥匙留在地址栏
    try {
      history.replaceState(null, '', location.pathname + (location.hash || ''));
    } catch (e) { /* 忽略 */ }
    if (cfg) writeCfg(cfg);
    return cfg;
  }

  /* ---------------- 状态订阅 ---------------- */
  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function notify() {
    var s = status();
    listeners.forEach(function (fn) { try { fn(s); } catch (e) { /* 忽略 */ } });
  }
  function status() {
    var c = readCfg();
    var a = build(c);
    return {
      configured: a.mode !== 'local',
      type: c.type, pending: pending,
      lastError: lastError,
      lastAt: lastSyncAt(),
      label: a.label()
    };
  }

  window.CloudSync = {
    readCfg: readCfg,
    writeCfg: writeCfg,
    status: status,
    syncNow: syncNow,
    testConnection: testConnection,
    onChange: onChange,
    notify: notify,
    buildInvite: buildInvite,
    consumeInvite: consumeInvite
  };

  /* 脚本一加载就吃掉邀请链接：这样同伴点开链接时，账本 init() 跑起来
     之前配置已经就位，开页自动拉取能直接生效。 */
  var joined = null;
  try { joined = consumeInvite(); } catch (e) { /* 忽略 */ }
  window.CloudSync.joinedFromInvite = joined;
})();
