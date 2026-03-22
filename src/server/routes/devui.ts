/**
 * Dev UI — served at GET /dev
 * Self-contained HTML (no build tools, no external deps).
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

const HTML = /* html */`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>Publish Dev UI</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'SF Mono',Consolas,monospace;background:#0f1117;color:#c9d1d9;min-height:100vh;display:flex;flex-direction:column;font-size:13px}
header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 18px;display:flex;align-items:center;gap:10px;flex-shrink:0}
header h1{font-size:15px;color:#e6edf3;font-weight:600}
.bdg{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
.bdg-dev{background:#5a1e02;color:#ffa657;border:1px solid #9e4b00}
.bdg-ok{background:#0d4429;color:#3fb950;border:1px solid #238636}
.bdg-no{background:#21262d;color:#8b949e;border:1px solid #30363d}
.bdg-warn{background:#2d1c00;color:#ffa657;border:1px solid #9e4b00}
main{display:grid;grid-template-columns:1fr 1fr;flex:1;overflow:hidden}
.panel{padding:16px 18px;overflow-y:auto;border-right:1px solid #21262d}
.panel:last-child{border-right:none}
h2{font-size:13px;color:#e6edf3;font-weight:600;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:8px}
h3{font-size:11px;color:#8b949e;font-weight:500;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.06em}
.card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;margin-bottom:10px}
.card-title{font-size:12px;color:#e6edf3;font-weight:500;margin-bottom:8px}
btn,button{background:#238636;color:#fff;border:none;padding:6px 13px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:500;transition:background .15s;display:inline-flex;align-items:center;gap:5px}
button:hover{background:#2ea043}
button.sec{background:#21262d;border:1px solid #30363d;color:#c9d1d9}
button.sec:hover{background:#30363d}
button.danger{background:#6e1010;border:1px solid #da3633;color:#f85149}
button.danger:hover{background:#8a1414}
textarea,input[type=text]{width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:5px;padding:8px;font-family:inherit;font-size:12px;line-height:1.5;outline:none}
textarea:focus,input[type=text]:focus{border-color:#388bfd}
.kv{display:grid;grid-template-columns:auto 1fr auto;align-items:start;gap:6px 8px;margin-bottom:4px}
.kv-label{color:#8b949e;font-size:11px;white-space:nowrap;padding-top:2px}
.kv-val{color:#79c0ff;font-size:11px;word-break:break-all;background:#0d1117;padding:4px 6px;border-radius:4px;border:1px solid #21262d;line-height:1.5}
.kv-val.priv{filter:blur(4px);cursor:pointer;user-select:none;transition:filter .2s}
.kv-val.priv.shown{filter:none}
.copy-btn{background:none;border:1px solid #30363d;color:#8b949e;padding:2px 6px;font-size:10px;border-radius:4px;cursor:pointer;white-space:nowrap}
.copy-btn:hover{color:#c9d1d9;border-color:#8b949e;background:none}
.step{display:flex;gap:8px;padding:7px 10px;margin-bottom:5px;border-radius:5px;background:#161b22;border:1px solid #21262d;cursor:pointer}
.step.pass{border-left:3px solid #238636}
.step.fail{border-left:3px solid #da3633}
.step.warn{border-left:3px solid #9e4b00}
.step-icon{font-size:13px;line-height:1.4;flex-shrink:0}
.step-hd{display:flex;align-items:center;gap:6px}
.step-name{color:#e6edf3;font-weight:500;font-size:12px}
.step-detail{color:#8b949e;font-size:11px;margin-top:2px}
.step-raw{display:none;margin-top:6px;background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px;font-size:10px;color:#79c0ff;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto}
.step-raw.open{display:block}
.expand-hint{color:#555;font-size:10px;margin-left:auto}
pre{background:#0d1117;border:1px solid #21262d;border-radius:5px;padding:10px;font-size:11px;overflow:auto;max-height:240px;color:#e6edf3;white-space:pre-wrap;word-break:break-word;margin-top:6px}
.msg{padding:7px 10px;border-radius:5px;font-size:12px;margin-top:6px}
.msg.ok{background:#0d4429;color:#3fb950;border:1px solid #238636}
.msg.err{background:#490202;color:#f85149;border:1px solid #da3633}
.msg.warn{background:#2d1c00;color:#ffa657;border:1px solid #9e4b00}
.divider{border:none;border-top:1px solid #21262d;margin:14px 0}
.tabs{display:flex;gap:2px;margin-bottom:12px;background:#0d1117;padding:3px;border-radius:6px}
.tab{flex:1;text-align:center;padding:5px;border-radius:4px;cursor:pointer;font-size:12px;color:#8b949e;border:none;background:none;font-family:inherit}
.tab.active{background:#21262d;color:#e6edf3}
.tab-content{display:none}.tab-content.active{display:block}
.row{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px}
.row label{color:#8b949e;font-size:11px;white-space:nowrap;padding-top:8px;min-width:72px}
</style>
</head>
<body>
<header>
  <h1>Publish Dev UI</h1>
  <span class="bdg bdg-dev">DEV ONLY</span>
  <span id="status-badge" class="bdg bdg-no">未初始化</span>
</header>

<main>
<!-- ======== LEFT: SERVER PANEL ======== -->
<div class="panel">
  <h2>服务端（发布方）</h2>

  <!-- INIT -->
  <div class="card">
    <div class="card-title">第一步：一键初始化</div>
    <p style="color:#8b949e;font-size:11px;margin-bottom:8px">生成根密钥对 + 签名密钥对 + 发布 KeyList + 创建管理员</p>
    <button onclick="doInit()">一键初始化</button>
    <button class="sec" onclick="doInit()" style="margin-left:4px">重新初始化</button>
    <div id="init-msg"></div>
  </div>

  <!-- KEY PAIRS -->
  <div class="card" id="keys-card" style="display:none">
    <div class="card-title">密钥信息（点击模糊区域可显示私钥）</div>

    <h3>根密钥对（Root Keypair）</h3>
    <p style="color:#8b949e;font-size:11px;margin-bottom:6px">根私钥在生产环境中永远离线保存，用于签名 KeyList</p>
    <div class="kv">
      <span class="kv-label">根公钥</span>
      <span class="kv-val" id="root-pub"></span>
      <button class="copy-btn" onclick="copy('root-pub')">复制</button>
    </div>
    <div class="kv">
      <span class="kv-label">根私钥</span>
      <span class="kv-val priv" id="root-priv" onclick="toggleBlur(this)">点击显示</span>
      <button class="copy-btn" onclick="copy('root-priv')">复制</button>
    </div>

    <h3>签名密钥对（Signing Keypair）</h3>
    <p style="color:#8b949e;font-size:11px;margin-bottom:6px">在线密钥，用于签名每个 Manifest；可撤销、可轮换</p>
    <div class="kv">
      <span class="kv-label">Key ID</span>
      <span class="kv-val" id="sign-id"></span>
      <button class="copy-btn" onclick="copy('sign-id')">复制</button>
    </div>
    <div class="kv">
      <span class="kv-label">签名公钥</span>
      <span class="kv-val" id="sign-pub"></span>
      <button class="copy-btn" onclick="copy('sign-pub')">复制</button>
    </div>
    <div class="kv">
      <span class="kv-label">签名私钥</span>
      <span class="kv-val priv" id="sign-priv" onclick="toggleBlur(this)">点击显示</span>
      <button class="copy-btn" onclick="copy('sign-priv')">复制</button>
    </div>
  </div>

  <hr class="divider">

  <!-- PUBLISH CONFIG -->
  <div class="card">
    <div class="card-title">第二步：发布配置</div>
    <p style="color:#8b949e;font-size:11px;margin-bottom:8px">编辑 JSON，点击发布（自动跳过审批，展示完整签名过程）</p>
    <textarea id="config-json" rows="10">${EXAMPLE_CONFIG}</textarea>
    <div style="margin-top:8px;display:flex;gap:6px">
      <button onclick="doPublish()">发布配置</button>
      <button class="sec" onclick="resetJson()">重置示例</button>
    </div>
    <div id="pub-msg"></div>
  </div>

  <!-- PUBLISH STEPS -->
  <div id="pub-steps" style="display:none">
    <h3>签名过程详情</h3>
    <div class="card">
      <div class="card-title">① Canonical JSON（确定性序列化）</div>
      <pre id="ps-canonical"></pre>
    </div>
    <div class="card">
      <div class="card-title">② 内容哈希 + 大小</div>
      <div class="kv"><span class="kv-label">SHA-256</span><span class="kv-val" id="ps-hash"></span><button class="copy-btn" onclick="copy('ps-hash')">复制</button></div>
      <div class="kv"><span class="kv-label">Size</span><span class="kv-val" id="ps-size"></span><span></span></div>
    </div>
    <div class="card">
      <div class="card-title">③ 未签名 Manifest</div>
      <pre id="ps-unsigned"></pre>
    </div>
    <div class="card">
      <div class="card-title">④ Ed25519 签名结果（签名私钥签的）</div>
      <div class="kv"><span class="kv-label">Signature</span><span class="kv-val" id="ps-sig" style="word-break:break-all"></span><button class="copy-btn" onclick="copy('ps-sig')">复制</button></div>
    </div>
  </div>

  <hr class="divider">

  <!-- MANUAL SIGN -->
  <div class="card">
    <div class="card-title">手动签名 / 验证</div>
    <div class="tabs">
      <button class="tab active" onclick="switchTab('sign')">手动签名</button>
      <button class="tab" onclick="switchTab('verify')">手动验证</button>
    </div>

    <div id="tab-sign" class="tab-content active">
      <div class="row"><label>数据</label><textarea id="ms-data" rows="3" placeholder="输入任意文本"></textarea></div>
      <div class="row"><label>私钥</label><input type="text" id="ms-priv" placeholder="留空则使用签名私钥"></div>
      <button onclick="doSign()">签名</button>
      <div id="ms-result"></div>
    </div>

    <div id="tab-verify" class="tab-content">
      <div class="row"><label>数据</label><textarea id="mv-data" rows="2" placeholder="原始文本"></textarea></div>
      <div class="row"><label>签名</label><input type="text" id="mv-sig" placeholder="Base64 签名"></div>
      <div class="row"><label>公钥</label><input type="text" id="mv-pub" placeholder="留空则使用签名公钥"></div>
      <button onclick="doVerifySig()">验证</button>
      <div id="mv-result"></div>
    </div>
  </div>
</div>

<!-- ======== RIGHT: CLIENT PANEL ======== -->
<div class="panel">
  <h2>客户端（验证方）</h2>
  <p style="color:#8b949e;font-size:11px;margin-bottom:12px">模拟客户端从服务端拉取配置并完整验证签名链（点击每个步骤可展开原始数据）</p>
  <button onclick="doVerify()">拉取并验证</button>

  <div id="verify-steps" style="margin-top:12px"></div>
  <div id="verify-config"></div>
</div>
</main>

<script>
var S = { token:null, rootPub:null, rootPriv:null, signId:null, signPub:null, signPriv:null };
var EXAMPLE = ${JSON.stringify(EXAMPLE_CONFIG)};

function api(method, path, body) {
  var h = {'Content-Type':'application/json'};
  if (S.token) h['Authorization'] = 'Bearer ' + S.token;
  return fetch(path, { method:method, headers:h, body:body?JSON.stringify(body):undefined })
    .then(function(r){ return r.json().then(function(d){ if(!r.ok) throw new Error(d.error||r.statusText); return d; }); });
}

function copy(id) {
  var el = document.getElementById(id);
  var text = el.dataset.val || el.textContent;
  navigator.clipboard.writeText(text).then(function(){ el.style.outline='1px solid #3fb950'; setTimeout(function(){ el.style.outline=''; }, 800); });
}

function toggleBlur(el) {
  el.classList.toggle('shown');
}

function switchTab(name) {
  document.querySelectorAll('.tab,.tab-content').forEach(function(el){ el.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  event.target.classList.add('active');
}

function doInit() {
  api('POST', '/dev/init').then(function(d) {
    S.token = d.token;
    S.rootPub = d.root_public_key;
    S.rootPriv = d.root_private_key;
    S.signId = d.signing_key_id;
    S.signPub = d.signing_public_key;
    S.signPriv = d.signing_private_key;

    document.getElementById('status-badge').textContent = '已就绪';
    document.getElementById('status-badge').className = 'bdg bdg-ok';

    setKV('root-pub', d.root_public_key);
    setKVBlur('root-priv', d.root_private_key);
    setKV('sign-id', d.signing_key_id);
    setKV('sign-pub', d.signing_public_key);
    setKVBlur('sign-priv', d.signing_private_key);
    document.getElementById('keys-card').style.display = 'block';

    // Pre-fill manual verify fields
    document.getElementById('mv-pub').value = d.signing_public_key;
    document.getElementById('ms-priv').placeholder = '留空则使用签名私钥 (已自动填入)';

    document.getElementById('init-msg').innerHTML = '<div class="msg ok">✓ 初始化成功</div>';
  }).catch(function(e){
    document.getElementById('init-msg').innerHTML = '<div class="msg err">✗ ' + e.message + '</div>';
  });
}

function setKV(id, val) {
  var el = document.getElementById(id);
  el.textContent = val;
  el.dataset.val = val;
}
function setKVBlur(id, val) {
  var el = document.getElementById(id);
  el.textContent = val;
  el.dataset.val = val;
  el.classList.remove('shown');
  el.classList.add('priv');
}

function doPublish() {
  if (!S.token) { document.getElementById('pub-msg').innerHTML='<div class="msg warn">⚠ 请先初始化</div>'; return; }
  var json;
  try { json = JSON.parse(document.getElementById('config-json').value); }
  catch(e) { document.getElementById('pub-msg').innerHTML='<div class="msg err">✗ JSON 格式错误: '+e.message+'</div>'; return; }

  api('POST', '/dev/quick-publish', { config: json }).then(function(d) {
    document.getElementById('pub-msg').innerHTML = '<div class="msg ok">✓ 已发布 version=' + d.version + '</div>';
    var ps = d.steps;
    document.getElementById('pub-steps').style.display = 'block';
    document.getElementById('ps-canonical').textContent = ps.canonical_json;
    setKV('ps-hash', ps.content_hash);
    document.getElementById('ps-size').textContent = ps.content_size + ' 字节';
    document.getElementById('ps-unsigned').textContent = JSON.stringify(ps.unsigned_manifest, null, 2);
    setKV('ps-sig', ps.signature);

    // Pre-fill manual verify with last signature
    document.getElementById('mv-sig').value = ps.signature;
    document.getElementById('mv-data').value = JSON.stringify(ps.unsigned_manifest);
  }).catch(function(e){
    document.getElementById('pub-msg').innerHTML = '<div class="msg err">✗ ' + e.message + '</div>';
  });
}

function doVerify() {
  document.getElementById('verify-steps').innerHTML = '<div style="color:#8b949e;font-size:12px;padding:8px 0">验证中...</div>';
  document.getElementById('verify-config').innerHTML = '';
  api('GET', '/dev/verify').then(function(d) {
    var html = d.steps.map(function(s) {
      var rawHtml = s.raw ? '<div class="step-raw" onclick="event.stopPropagation()">'+JSON.stringify(s.raw, null, 2)+'</div>' : '';
      return '<div class="step '+(s.ok?'pass':'fail')+'" onclick="toggleRaw(this)">'
        + '<span class="step-icon">'+(s.ok?'✓':'✗')+'</span>'
        + '<div style="flex:1"><div class="step-hd"><span class="step-name">'+s.name+'</span>'
        + (s.raw?'<span class="expand-hint">点击展开数据</span>':'')+'</div>'
        + (s.detail?'<div class="step-detail">'+s.detail+'</div>':'')
        + rawHtml + '</div></div>';
    }).join('');
    document.getElementById('verify-steps').innerHTML = html;

    if (d.config) {
      document.getElementById('verify-config').innerHTML =
        '<h3 style="margin-top:12px;margin-bottom:6px;font-size:11px;color:#8b949e;text-transform:uppercase">最终配置内容</h3>'
        + '<pre>'+JSON.stringify(d.config, null, 2)+'</pre>';
    }
  }).catch(function(e){
    document.getElementById('verify-steps').innerHTML = '<div class="msg err">✗ ' + e.message + '</div>';
  });
}

function toggleRaw(el) {
  var raw = el.querySelector('.step-raw');
  if (raw) raw.classList.toggle('open');
}

function doSign() {
  var data = document.getElementById('ms-data').value;
  if (!data) { document.getElementById('ms-result').innerHTML='<div class="msg warn">请输入数据</div>'; return; }
  var privKey = document.getElementById('ms-priv').value || undefined;
  api('POST', '/dev/sign', { data: data, private_key: privKey }).then(function(d) {
    document.getElementById('ms-result').innerHTML =
      '<div class="msg ok">✓ 签名成功</div>'
      + '<div class="kv" style="margin-top:6px"><span class="kv-label">Signature</span>'
      + '<span class="kv-val" id="ms-sig-out" style="word-break:break-all">'+d.signature+'</span>'
      + '<button class="copy-btn" onclick="copy(\\'ms-sig-out\\')">复制</button></div>'
      + '<div style="color:#8b949e;font-size:11px;margin-top:4px">使用私钥: '+d.private_key_used+'</div>';
    // Auto-fill verify tab
    document.getElementById('mv-data').value = data;
    document.getElementById('mv-sig').value = d.signature;
    if (!document.getElementById('mv-pub').value && S.signPub) document.getElementById('mv-pub').value = S.signPub;
  }).catch(function(e){
    document.getElementById('ms-result').innerHTML = '<div class="msg err">✗ ' + e.message + '</div>';
  });
}

function doVerifySig() {
  var data = document.getElementById('mv-data').value;
  var sig = document.getElementById('mv-sig').value;
  var pub = document.getElementById('mv-pub').value;
  if (!data || !sig || !pub) { document.getElementById('mv-result').innerHTML='<div class="msg warn">请填写数据、签名和公钥</div>'; return; }
  api('POST', '/dev/verify-sig', { data:data, signature:sig, public_key:pub }).then(function(d) {
    document.getElementById('mv-result').innerHTML = d.valid
      ? '<div class="msg ok">✓ 签名有效</div>'
      : '<div class="msg err">✗ 签名无效' + (d.error?' — '+d.error:'') + '</div>';
  }).catch(function(e){
    document.getElementById('mv-result').innerHTML = '<div class="msg err">✗ ' + e.message + '</div>';
  });
}

function resetJson() { document.getElementById('config-json').value = EXAMPLE; }

// Check status on load
api('GET', '/dev/status').then(function(d) {
  if (d.initialized) {
    document.getElementById('status-badge').textContent = '服务有数据，需重新初始化获取密钥';
    document.getElementById('status-badge').className = 'bdg bdg-warn';
  }
}).catch(function(){});
</script>
</body>
</html>`;

export function createDevUiRoute(): Hono {
  const app = new Hono();
  app.get("/", (c) => {
    // Allow inline scripts/styles for the dev UI page
    c.header("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
    return c.html(HTML);
  });
  return app;
}
