/* =============================================================
   sync-worker.example.js — 云同步「自建端点」后端示例（Cloudflare Worker）

   什么时候需要它：
   账本首选后端是 Upstash Redis。第三方服务有可能不给跨域（CORS）头，
   浏览器会把这种情况报成 "Failed to fetch"，看起来跟断网一模一样。
   自建端点的跨域头由你自己返回，等于把这个不确定因素彻底去掉。

   怎么用（全程免费，约 3 分钟）：
   1. 注册 cloudflare.com → Workers & Pages → Create → Hello World
   2. 把本文件内容整段粘进 worker.js，改掉下面两行常量
   3. Deploy，拿到形如 https://eu26-sync.xxx.workers.dev 的地址
   4. 账本里：后端选「自建端点」，地址填上面那个，令牌填你的 PIN，
      房间号两台设备填一样的（比如 eu2026）

   安全说明：PIN 只防误填和顺手扫的机器人，不防真攻击者。
   账本里没有银行卡号这类东西，够用了；别拿它存敏感信息。
   ============================================================= */

// 改成你自己的口令，两台设备填一样的
var PIN = 'change-me-2026';

// KV 命名空间（必选，不配就存不住）：
// Workers → KV → Create namespace（名字随意）→ 回到 Worker → Settings →
// Bindings → Add → KV namespace → 变量名填 LEDGER。
// 少了这步，PUT 会直接报错，不会静默丢数据。

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    var room = url.searchParams.get('room') || 'eu2026';
    var key = 'eu26:' + room;

    // 跨域头：预检请求必须先答，否则浏览器连真正的请求都不发
    var cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Pin',
      'Access-Control-Max-Age': '86400'
    };
    if (request.method === 'OPTIONS') {
      return new Response('', { status: 204, headers: cors });
    }

    if (request.headers.get('X-Sync-Pin') !== PIN) {
      return json({ error: 'PIN 不对' }, 401, cors);
    }

    try {
      if (!env.LEDGER) {
        return json({ error: '没绑定 KV（变量名 LEDGER），存不进去' }, 500, cors);
      }
      if (request.method === 'GET') {
        var raw = await env.LEDGER.get(key);
        // 没数据时返回 204：客户端据此判断「远端还是空的」
        if (!raw) return new Response('', { status: 204, headers: cors });
        return new Response(raw, {
          status: 200,
          headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
        });
      }
      if (request.method === 'PUT') {
        var body = await request.text();
        // 先解析一遍再存，坏数据别写进去，否则两台设备都会读不出来
        JSON.parse(body);
        await env.LEDGER.put(key, body);
        return json({ ok: true }, 200, cors);
      }
      return json({ error: '只支持 GET / PUT' }, 405, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, cors);
    }
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
  });
}
