/**
 * Dev UI — served at GET /dev
 * A self-contained HTML page (no build tools, no external deps).
 */
import { Hono } from "hono";

const EXAMPLE_CONFIG = JSON.stringify(
  {
    features: { dark_mode: true, beta_features: false },
    endpoints: { api: "https://api.example.com", cdn: "https://cdn.example.com" },
    custom: { message: "Hello from dev!" },
  },
  null,
  2,
);

const HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Publish Dev UI</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'SF Mono',Consolas,monospace;background:#0f1117;color:#c9d1d9;min-height:100vh;display:flex;flex-direction:column}
header{background:#161b22;border-bottom:1px solid #30363d;padding:12px 20px;display:flex;align-items:center;gap:12px}
header h1{font-size:16px;color:#e6edf3;font-weight:600}
.badge{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500}
.badge-dev{background:#5a1e02;color:#ffa657;border:1px solid #9e4b00}
.badge-ok{background:#0d4429;color:#3fb950;border:1px solid #238636}
.badge-no{background:#21262d;color:#8b949e;border:1px solid #30363d}
main{display:grid;grid-template-columns:1fr 1fr;gap:0;flex:1}
.panel{padding:20px;border-right:1px solid #21262d}
.panel:last-child{border-right:none}
h2{font-size:14px;color:#e6edf3;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #21262d}
h3{font-size:12px;color:#8b949e;margin:16px 0 8px;text-transform:uppercase;letter-spacing:.05em}
.card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:14px;margin-bottom:12px}
button{background:#238636;color:#fff;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:500;transition:background .15s}
button:hover{background:#2ea043}
button.secondary{background:#21262d;border:1px solid #30363d;color:#c9d1d9}
button.secondary:hover{background:#30363d}
button:disabled{opacity:.5;cursor:not-allowed}
textarea{width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:10px;font-family:inherit;font-size:12px;line-height:1.5;resize:vertical;outline:none}
textarea:focus{border-color:#388bfd}
.info-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px}
.info-label{color:#8b949e;min-width:80px}
.info-val{color:#79c0ff;word-break:break-all;font-size:11px}
.step{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;margin-bottom:6px;border-radius:6px;background:#161b22;border:1px solid #21262d;font-size:12px}
.step.pass{border-left:3px solid #238636}
.step.fail{border-left:3px solid #da3633}
.step-icon{font-size:14px;line-height:1.3;flex-shrink:0}
.step-body{}
.step-name{color:#e6edf3;font-weight:500}
.step-detail{color:#8b949e;font-size:11px;margin-top:2px}
pre{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px;font-size:11px;overflow:auto;max-height:260px;color:#e6edf3;white-space:pre-wrap;word-break:break-word}
.msg{padding:8px 10px;border-radius:6px;font-size:12px;margin-top:8px}
.msg.ok{background:#0d4429;color:#3fb950;border:1px solid #238636}
.msg.err{background:#490202;color:#f85149;border:1px solid #da3633}
.msg.warn{background:#2d1c00;color:#ffa657;border:1px solid #9e4b00}
.divider{border:none;border-top:1px solid #21262d;margin:16px 0}
</style>
</head>
<body>
<header>
  <h1>Publish Dev UI</h1>
  <span class="badge badge-dev">DEV ONLY</span>
  <span id="status-badge" class="badge badge-no">未初始化</span>
</header>

<main>
  <!-- ===== LEFT: PUBLISH PANEL ===== -->
  <div class="panel">
    <h2>发布面板</h2>

    <div class="card" id="init-card">
      <h3>第一步：初始化</h3>
      <p style="font-size:12px;color:#8b949e;margin-bottom:10px">
        自动生成根密钥对、签名密钥、创建管理员账户。
      </p>
      <button onclick="doInit()">一键初始化</button>
      <div id="init-result"></div>

      <div id="init-info" style="display:none;margin-top:12px">
        <div class="info-row"><span class="info-label">根公钥</span><span class="info-val" id="val-rootpub"></span></div>
        <div class="info-row"><span class="info-label">签名密钥</span><span class="info-val" id="val-keyid"></span></div>
        <div class="info-row"><span class="info-label">用户</span><span class="info-val">dev-admin（已自动登录）</span></div>
      </div>
    </div>

    <hr class="divider">

    <div class="card">
      <h3>第二步：编辑并发布配置</h3>
      <p style="font-size:12px;color:#8b949e;margin-bottom:8px">
        修改下面的 JSON，点击「发布配置」即可（自动跳过审批流程）。
      </p>
      <textarea id="config-json" rows="14">${EXAMPLE_CONFIG}</textarea>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
        <button onclick="doPublish()">发布配置</button>
        <button class="secondary" onclick="resetJson()">重置示例</button>
      </div>
      <div id="publish-result"></div>
    </div>
  </div>

  <!-- ===== RIGHT: VERIFY PANEL ===== -->
  <div class="panel">
    <h2>验证面板</h2>
    <p style="font-size:12px;color:#8b949e;margin-bottom:12px">
      模拟客户端拉取配置并逐步验证签名链。
    </p>
    <button onclick="doVerify()">拉取并验证</button>

    <div id="verify-steps" style="margin-top:14px"></div>
    <div id="verify-config"></div>
  </div>
</main>

<script>
var state = { token: null, rootPub: null, keyId: null };
var EXAMPLE = ${JSON.stringify(EXAMPLE_CONFIG)};

function api(method, path, body) {
  var headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  return fetch(path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  }).then(function(r) {
    return r.json().then(function(d) {
      if (!r.ok) throw new Error(d.error || r.statusText);
      return d;
    });
  });
}

function doInit() {
  api('POST', '/dev/init').then(function(d) {
    state.token = d.token;
    state.rootPub = d.root_public_key;
    state.keyId = d.key_id;

    document.getElementById('status-badge').textContent = '已就绪';
    document.getElementById('status-badge').className = 'badge badge-ok';
    document.getElementById('init-info').style.display = 'block';
    document.getElementById('val-rootpub').textContent = d.root_public_key;
    document.getElementById('val-keyid').textContent = d.key_id;
    document.getElementById('init-result').innerHTML = '<div class="msg ok">✓ 初始化成功</div>';
  }).catch(function(e) {
    document.getElementById('init-result').innerHTML = '<div class="msg err">✗ ' + e.message + '</div>';
  });
}

function doPublish() {
  if (!state.token) {
    document.getElementById('publish-result').innerHTML = '<div class="msg warn">⚠ 请先点击「一键初始化」</div>';
    return;
  }
  var json;
  try { json = JSON.parse(document.getElementById('config-json').value); }
  catch(e) { document.getElementById('publish-result').innerHTML = '<div class="msg err">✗ JSON 格式错误: ' + e.message + '</div>'; return; }

  api('POST', '/dev/quick-publish', { config: json }).then(function(d) {
    document.getElementById('publish-result').innerHTML =
      '<div class="msg ok">✓ 已发布 version=' + d.version + '</div>';
  }).catch(function(e) {
    document.getElementById('publish-result').innerHTML = '<div class="msg err">✗ ' + e.message + '</div>';
  });
}

function doVerify() {
  document.getElementById('verify-steps').innerHTML = '<div style="color:#8b949e;font-size:12px">验证中...</div>';
  document.getElementById('verify-config').innerHTML = '';

  api('GET', '/dev/verify').then(function(d) {
    var html = d.steps.map(function(s) {
      return '<div class="step ' + (s.ok ? 'pass' : 'fail') + '">'
        + '<span class="step-icon">' + (s.ok ? '✓' : '✗') + '</span>'
        + '<div class="step-body"><div class="step-name">' + s.name + '</div>'
        + (s.detail ? '<div class="step-detail">' + s.detail + '</div>' : '')
        + '</div></div>';
    }).join('');
    document.getElementById('verify-steps').innerHTML = html;

    if (d.config) {
      document.getElementById('verify-config').innerHTML =
        '<h3 style="margin-top:14px;margin-bottom:8px;font-size:12px;color:#8b949e;text-transform:uppercase">最终配置内容</h3>'
        + '<pre>' + JSON.stringify(d.config, null, 2) + '</pre>';
    }
  }).catch(function(e) {
    document.getElementById('verify-steps').innerHTML = '<div class="msg err">✗ ' + e.message + '</div>';
  });
}

function resetJson() {
  document.getElementById('config-json').value = EXAMPLE;
}

// Check status on load
api('GET', '/dev/status').then(function(d) {
  if (d.initialized) {
    document.getElementById('status-badge').textContent = '服务已有数据（需重新初始化获取 Token）';
    document.getElementById('status-badge').className = 'badge badge-dev';
  }
}).catch(function() {});
</script>
</body>
</html>`;

export function createDevUiRoute(): Hono {
  const app = new Hono();
  app.get("/", (c) => c.html(HTML));
  return app;
}
