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
.bdg-blue{background:#0d2149;color:#79c0ff;border:1px solid #388bfd}
main{display:grid;grid-template-columns:1fr 1fr;flex:1;overflow:hidden}
.panel{padding:16px 18px;overflow-y:auto;border-right:1px solid #21262d}
.panel:last-child{border-right:none}
h2{font-size:13px;color:#e6edf3;font-weight:600;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #21262d}
h3{font-size:11px;color:#8b949e;font-weight:500;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.06em}
p.hint{color:#8b949e;font-size:11px;margin-bottom:8px}
.card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;margin-bottom:10px}
.card-title{font-size:12px;color:#e6edf3;font-weight:500;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.step-num{background:#21262d;color:#8b949e;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0}
.step-num.active{background:#0d2149;color:#79c0ff}
.step-num.done{background:#0d4429;color:#3fb950}
button{background:#238636;color:#fff;border:none;padding:6px 13px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:500;transition:background .15s}
button:hover{background:#2ea043}
button.sec{background:#21262d;border:1px solid #30363d;color:#c9d1d9}
button.sec:hover{background:#30363d}
button.approve{background:#0d4429;border:1px solid #238636;color:#3fb950}
button.approve:hover{background:#1a6331}
button.reject{background:#490202;border:1px solid #da3633;color:#f85149}
button.reject:hover{background:#6e1010}
button.blue{background:#0d2149;border:1px solid #388bfd;color:#79c0ff}
button.blue:hover{background:#1a3a6e}
button:disabled{opacity:.4;cursor:not-allowed}
textarea,input[type=text]{width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:5px;padding:8px;font-family:inherit;font-size:12px;line-height:1.5;outline:none}
textarea:focus,input[type=text]:focus{border-color:#388bfd}
.kv{display:grid;grid-template-columns:auto 1fr auto;align-items:start;gap:6px 8px;margin-bottom:4px}
.kv-label{color:#8b949e;font-size:11px;white-space:nowrap;padding-top:3px}
.kv-val{color:#79c0ff;font-size:11px;word-break:break-all;background:#0d1117;padding:4px 6px;border-radius:4px;border:1px solid #21262d;line-height:1.5}
.kv-val.priv{filter:blur(4px);cursor:pointer;transition:filter .2s}
.kv-val.priv.shown{filter:none}
.copy-btn{background:none;border:1px solid #30363d;color:#8b949e;padding:2px 6px;font-size:10px;border-radius:4px;cursor:pointer;white-space:nowrap}
.copy-btn:hover{color:#c9d1d9;border-color:#8b949e;background:none}
.vstep{display:flex;gap:8px;padding:7px 10px;margin-bottom:5px;border-radius:5px;background:#161b22;border:1px solid #21262d;cursor:pointer}
.vstep.pass{border-left:3px solid #238636}
.vstep.fail{border-left:3px solid #da3633}
.vstep-icon{font-size:13px;line-height:1.4;flex-shrink:0}
.vstep-name{color:#e6edf3;font-weight:500;font-size:12px}
.vstep-detail{color:#8b949e;font-size:11px;margin-top:2px}
.vstep-raw{display:none;margin-top:6px;background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px;font-size:10px;color:#79c0ff;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto}
.vstep-raw.open{display:block}
.expand-hint{color:#555;font-size:10px;margin-left:auto}
pre{background:#0d1117;border:1px solid #21262d;border-radius:5px;padding:10px;font-size:11px;overflow:auto;max-height:260px;color:#e6edf3;white-space:pre-wrap;word-break:break-word;margin-top:4px}
.msg{padding:7px 10px;border-radius:5px;font-size:12px;margin-top:6px}
.msg.ok{background:#0d4429;color:#3fb950;border:1px solid #238636}
.msg.err{background:#490202;color:#f85149;border:1px solid #da3633}
.msg.warn{background:#2d1c00;color:#ffa657;border:1px solid #9e4b00}
.msg.info{background:#0d2149;color:#79c0ff;border:1px solid #388bfd}
.divider{border:none;border-top:1px solid #21262d;margin:14px 0}
.tabs{display:flex;gap:2px;margin-bottom:12px;background:#0d1117;padding:3px;border-radius:6px}
.tab{flex:1;text-align:center;padding:5px;border-radius:4px;cursor:pointer;font-size:12px;color:#8b949e;border:none;background:none;font-family:inherit}
.tab.active{background:#21262d;color:#e6edf3}
.tab-content{display:none}.tab-content.active{display:block}
.row{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px}
.row label{color:#8b949e;font-size:11px;white-space:nowrap;padding-top:8px;min-width:72px}
.config-preview{background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px;font-size:11px;color:#8b949e;max-height:100px;overflow:auto;white-space:pre-wrap;margin:6px 0;cursor:pointer}
.config-preview:hover{border-color:#388bfd;color:#c9d1d9}
.pending-item{background:#0d1117;border:1px solid #30363d;border-radius:5px;padding:10px;margin-bottom:8px}
.pending-header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.pending-actions{display:flex;gap:6px;margin-top:8px}
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
  <h2>服务端（完整发布流程）</h2>

  <!-- STEP 0: INIT -->
  <div class="card">
    <div class="card-title"><span class="step-num" id="sn0">0</span>初始化</div>
    <p class="hint">生成根密钥对 + 签名密钥对 + 创建发布方/审核方账户</p>
    <div style="display:flex;gap:6px">
      <button id="btn-init">一键初始化</button>
      <button class="sec" id="btn-reinit">重新初始化</button>
    </div>
    <div id="init-msg"></div>
  </div>

  <!-- KEYS CARD -->
  <div class="card" id="keys-card" style="display:none">
    <div class="card-title">密钥信息（私钥点击可显示）</div>
    <h3>根密钥对 — 用于签名 KeyList（生产环境永远离线）</h3>
    <div class="kv"><span class="kv-label">根公钥</span><span class="kv-val" id="root-pub"></span><button class="copy-btn" id="cp-root-pub">复制</button></div>
    <div class="kv"><span class="kv-label">根私钥</span><span class="kv-val priv" id="root-priv">点击显示</span><button class="copy-btn" id="cp-root-priv">复制</button></div>
    <h3>签名密钥对 — 用于签名每个 Manifest（可撤销轮换）</h3>
    <div class="kv"><span class="kv-label">Key ID</span><span class="kv-val" id="sign-id"></span><button class="copy-btn" id="cp-sign-id">复制</button></div>
    <div class="kv"><span class="kv-label">签名公钥</span><span class="kv-val" id="sign-pub"></span><button class="copy-btn" id="cp-sign-pub">复制</button></div>
    <div class="kv"><span class="kv-label">签名私钥</span><span class="kv-val priv" id="sign-priv">点击显示</span><button class="copy-btn" id="cp-sign-priv">复制</button></div>
  </div>

  <hr class="divider">

  <!-- STEP 1: WRITE & SUBMIT -->
  <div class="card">
    <div class="card-title"><span class="step-num" id="sn1">1</span>发布方：写配置并提交审核</div>
    <p class="hint">编辑 JSON 配置，提交后进入待审核状态，等待审核方操作</p>
    <textarea id="config-json" rows="10">${EXAMPLE_CONFIG}</textarea>
    <div style="margin-top:8px;display:flex;gap:6px">
      <button id="btn-submit">提交审核</button>
      <button class="sec" id="btn-reset-json">重置示例</button>
    </div>
    <div id="submit-msg"></div>
  </div>

  <!-- STEP 2: REVIEW -->
  <div class="card">
    <div class="card-title"><span class="step-num" id="sn2">2</span>审核方：审批配置</div>
    <p class="hint">以下是待审核的配置，点击内容可展开查看，审核后决定通过或拒绝</p>
    <button class="sec" id="btn-refresh">刷新待审列表</button>
    <div id="pending-list" style="margin-top:8px">
      <div style="color:#555;font-size:12px;padding:8px 0">暂无待审核配置</div>
    </div>
  </div>

  <!-- STEP 3: SIGN & PUBLISH -->
  <div class="card" id="publish-section" style="display:none;border-color:#388bfd">
    <div class="card-title"><span class="step-num active" id="sn3">3</span>发布方：签名发布</div>
    <p class="hint">版本 <strong id="approved-ver" style="color:#79c0ff"></strong> 已通过审核，可以用签名私钥签名并发布</p>
    <button class="blue" id="btn-sign-publish">签名发布</button>
    <div id="pub-msg"></div>
  </div>

  <!-- SIGNING STEPS (shown after publish) -->
  <div id="pub-steps" style="display:none">
    <h3>签名过程详情</h3>
    <div class="card">
      <div class="card-title">① Canonical JSON（确定性序列化）</div>
      <pre id="ps-canonical"></pre>
    </div>
    <div class="card">
      <div class="card-title">② 内容哈希 + 大小</div>
      <div class="kv"><span class="kv-label">SHA-256</span><span class="kv-val" id="ps-hash"></span><button class="copy-btn" id="cp-ps-hash">复制</button></div>
      <div class="kv"><span class="kv-label">Size</span><span class="kv-val" id="ps-size"></span><span></span></div>
    </div>
    <div class="card">
      <div class="card-title">③ 未签名 Manifest</div>
      <pre id="ps-unsigned"></pre>
    </div>
    <div class="card">
      <div class="card-title">④ Ed25519 签名（用签名私钥）</div>
      <div class="kv"><span class="kv-label">Signature</span><span class="kv-val" id="ps-sig"></span><button class="copy-btn" id="cp-ps-sig">复制</button></div>
    </div>
    <div class="card" style="border-color:#388bfd">
      <div class="card-title" style="color:#79c0ff">⑤ 客户端收到的完整数据包（GET /v1/config/latest 响应）</div>
      <p class="hint">包含签名后的 manifest + 配置正文，客户端验签后才使用</p>
      <pre id="ps-client-json" style="max-height:360px"></pre>
    </div>
  </div>

  <hr class="divider">

  <!-- MANUAL SIGN / VERIFY -->
  <div class="card">
    <div class="card-title">手动签名 / 验证（了解底层密码学）</div>
    <div class="tabs">
      <button class="tab active" id="tab-btn-sign">手动签名</button>
      <button class="tab" id="tab-btn-verify">手动验证</button>
    </div>
    <div id="tab-sign" class="tab-content active">
      <div class="row"><label>数据</label><textarea id="ms-data" rows="3" placeholder="输入任意文本"></textarea></div>
      <div class="row"><label>私钥</label><input type="text" id="ms-priv" placeholder="留空则使用签名私钥"></div>
      <button id="btn-manual-sign">签名</button>
      <div id="ms-result"></div>
    </div>
    <div id="tab-verify" class="tab-content">
      <div class="row"><label>数据</label><textarea id="mv-data" rows="2" placeholder="原始文本"></textarea></div>
      <div class="row"><label>签名</label><input type="text" id="mv-sig" placeholder="Base64 签名"></div>
      <div class="row"><label>公钥</label><input type="text" id="mv-pub" placeholder="留空则使用签名公钥"></div>
      <button id="btn-manual-verify">验证</button>
      <div id="mv-result"></div>
    </div>
  </div>
</div>

<!-- ======== RIGHT: CLIENT PANEL ======== -->
<div class="panel">
  <h2>客户端（验证方）</h2>
  <p class="hint">模拟客户端从服务端拉取配置，逐步验证完整信任链（点击步骤可展开原始数据）</p>
  <button id="btn-verify">拉取并验证</button>
  <div id="verify-steps" style="margin-top:12px"></div>
  <div id="verify-config"></div>
</div>
</main>

<script>
var S = { publisherToken:null, reviewerToken:null, signId:null, signPub:null, signPriv:null, approvedVersion:null };
var EXAMPLE = ${JSON.stringify(EXAMPLE_CONFIG)};

// ── API helpers ──────────────────────────────────────────────
function apiWith(token, method, path, body) {
  var h = {'Content-Type':'application/json'};
  if (token) h['Authorization'] = 'Bearer ' + token;
  return fetch(path, { method:method, headers:h, body:body?JSON.stringify(body):undefined })
    .then(function(r){ return r.json().then(function(d){ if(!r.ok) throw new Error(d.error||r.statusText); return d; }); });
}
function apiPub(method, path, body){ return apiWith(S.publisherToken, method, path, body); }
function apiRev(method, path, body){ return apiWith(S.reviewerToken, method, path, body); }
function apiDev(method, path, body){ return apiWith(null, method, path, body); }

// ── Key display helpers ──────────────────────────────────────
function setKV(id, val){ var el=document.getElementById(id); el.textContent=val; el.dataset.val=val; }
function setKVBlur(id, val){ var el=document.getElementById(id); el.textContent=val; el.dataset.val=val; el.classList.add('priv'); el.classList.remove('shown'); }

function copyEl(id){ var el=document.getElementById(id); navigator.clipboard.writeText(el.dataset.val||el.textContent).then(function(){ el.style.outline='1px solid #3fb950'; setTimeout(function(){ el.style.outline=''; },800); }); }

function markStep(n, state){
  var el = document.getElementById('sn'+n);
  el.className = 'step-num' + (state==='done'?' done':state==='active'?' active':'');
  el.textContent = state==='done' ? '✓' : n;
}

// ── Init ─────────────────────────────────────────────────────
function doInit(){
  apiDev('POST', '/dev/init').then(function(d){
    S.publisherToken = d.publisher_token;
    S.reviewerToken  = d.reviewer_token;
    S.signId  = d.signing_key_id;
    S.signPub = d.signing_public_key;
    S.signPriv = d.signing_private_key;

    document.getElementById('status-badge').textContent='已就绪';
    document.getElementById('status-badge').className='bdg bdg-ok';
    document.getElementById('init-msg').innerHTML='<div class="msg ok">✓ 初始化成功 — 发布方: dev-publisher，审核方: dev-reviewer</div>';

    setKV('root-pub', d.root_public_key);
    setKVBlur('root-priv', d.root_private_key);
    setKV('sign-id', d.signing_key_id);
    setKV('sign-pub', d.signing_public_key);
    setKVBlur('sign-priv', d.signing_private_key);
    document.getElementById('keys-card').style.display='block';
    document.getElementById('mv-pub').value = d.signing_public_key;
    markStep(0,'done'); markStep(1,'active');
  }).catch(function(e){
    document.getElementById('init-msg').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
  });
}

// ── Submit for review ────────────────────────────────────────
function doSubmit(){
  if(!S.publisherToken){ document.getElementById('submit-msg').innerHTML='<div class="msg warn">⚠ 请先初始化</div>'; return; }
  var json;
  try{ json=JSON.parse(document.getElementById('config-json').value); }
  catch(e){ document.getElementById('submit-msg').innerHTML='<div class="msg err">✗ JSON 格式错误: '+e.message+'</div>'; return; }

  apiPub('POST','/v1/admin/configs',{changes:json})
    .then(function(d){
      return apiPub('POST','/v1/admin/configs/'+d.version+'/submit').then(function(s){
        document.getElementById('submit-msg').innerHTML='<div class="msg info">↑ 已提交审核 version='+s.version+'，等待审核方审批</div>';
        markStep(1,'done'); markStep(2,'active');
        loadPending();
      });
    })
    .catch(function(e){ document.getElementById('submit-msg').innerHTML='<div class="msg err">✗ '+e.message+'</div>'; });
}

// ── Pending list ─────────────────────────────────────────────
function loadPending(){
  apiPub('GET','/v1/admin/configs').then(function(configs){
    var active = configs.filter(function(c){ return c.status==='pending_review'||c.status==='approved'; });
    var el = document.getElementById('pending-list');
    if(!active.length){ el.innerHTML='<div style="color:#555;font-size:12px;padding:8px 0">暂无待审核配置</div>'; return; }
    el.innerHTML='';
    active.forEach(function(cfg){
      apiPub('GET','/v1/admin/configs/'+cfg.version).then(function(detail){
        var item = document.createElement('div');
        item.className = 'pending-item';
        var statusColor = cfg.status==='approved'?'#3fb950':cfg.status==='pending_review'?'#ffa657':'#8b949e';
        var preview = JSON.stringify(detail.config_content, null, 2).substring(0,200)+'...';
        item.innerHTML =
          '<div class="pending-header">'
          +'<span style="color:#e6edf3;font-weight:500">version '+cfg.version+'</span>'
          +'<span class="bdg" style="background:#0d1117;color:'+statusColor+';border:1px solid '+statusColor+'">'+cfg.status+'</span>'
          +'</div>'
          +'<div class="config-preview" id="preview-'+cfg.version+'">'+preview+'</div>';

        var actions = document.createElement('div');
        actions.className = 'pending-actions';

        if(cfg.status==='pending_review'){
          var btnApprove = document.createElement('button');
          btnApprove.className='approve'; btnApprove.textContent='✓ 通过审批';
          btnApprove.addEventListener('click', function(){ doApprove(cfg.version); });

          var btnReject = document.createElement('button');
          btnReject.className='reject'; btnReject.textContent='✗ 拒绝';
          btnReject.addEventListener('click', function(){ doReject(cfg.version); });

          actions.appendChild(btnApprove);
          actions.appendChild(btnReject);
        }

        if(cfg.status==='approved'){
          var btnPub = document.createElement('button');
          btnPub.className='blue'; btnPub.textContent='签名发布';
          btnPub.addEventListener('click', function(){ showPublishSection(cfg.version); });
          actions.appendChild(btnPub);
        }

        item.appendChild(actions);

        // Toggle full content on preview click
        item.querySelector('.config-preview').addEventListener('click', function(){
          this.textContent = this.textContent.endsWith('...') ? JSON.stringify(detail.config_content, null, 2) : preview;
        });

        el.appendChild(item);
      });
    });
  }).catch(function(e){
    document.getElementById('pending-list').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
  });
}

function doApprove(version){
  apiRev('POST','/v1/admin/configs/'+version+'/approve').then(function(d){
    if(d.auto_approved || d.status==='approved'){
      showPublishSection(version);
      markStep(2,'done'); markStep(3,'active');
    }
    loadPending();
  }).catch(function(e){ alert('审批失败: '+e.message); });
}

function doReject(version){
  apiRev('POST','/v1/admin/configs/'+version+'/reject',{comment:'dev rejected'}).then(function(){
    loadPending();
    document.getElementById('pending-list').insertAdjacentHTML('afterbegin','<div class="msg warn" style="margin-bottom:8px">已拒绝 version='+version+'，配置回到草稿状态</div>');
  }).catch(function(e){ alert('拒绝失败: '+e.message); });
}

function showPublishSection(version){
  S.approvedVersion = version;
  document.getElementById('approved-ver').textContent = version;
  document.getElementById('publish-section').style.display='block';
  document.getElementById('publish-section').scrollIntoView({behavior:'smooth',block:'nearest'});
}

// ── Sign & Publish ────────────────────────────────────────────
function doSignPublish(){
  if(!S.approvedVersion){ return; }
  apiDev('POST','/dev/sign-publish/'+S.approvedVersion).then(function(d){
    document.getElementById('pub-msg').innerHTML='<div class="msg ok">✓ 已发布 version='+d.version+'</div>';
    markStep(3,'done');

    var ps = d.steps;
    document.getElementById('pub-steps').style.display='block';
    document.getElementById('ps-canonical').textContent = ps.canonical_json;
    setKV('ps-hash', ps.content_hash);
    document.getElementById('ps-size').textContent = ps.content_size + ' 字节';
    document.getElementById('ps-unsigned').textContent = JSON.stringify(ps.unsigned_manifest, null, 2);
    setKV('ps-sig', ps.signature);
    document.getElementById('ps-client-json').textContent = JSON.stringify(d.client_payload, null, 2);

    document.getElementById('mv-sig').value = ps.signature;
    document.getElementById('mv-data').value = JSON.stringify(ps.unsigned_manifest);

    document.getElementById('pub-steps').scrollIntoView({behavior:'smooth',block:'start'});
  }).catch(function(e){
    document.getElementById('pub-msg').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
  });
}

// ── Verify (right panel) ─────────────────────────────────────
function doVerify(){
  document.getElementById('verify-steps').innerHTML='<div style="color:#8b949e;font-size:12px;padding:8px 0">验证中...</div>';
  document.getElementById('verify-config').innerHTML='';
  apiDev('GET','/dev/verify').then(function(d){
    var html = d.steps.map(function(s){
      var rawHtml = s.raw ? '<div class="vstep-raw">'+JSON.stringify(s.raw,null,2)+'</div>' : '';
      return '<div class="vstep '+(s.ok?'pass':'fail')+'">'
        +'<span class="vstep-icon">'+(s.ok?'✓':'✗')+'</span>'
        +'<div style="flex:1"><div style="display:flex;align-items:center"><span class="vstep-name">'+s.name+'</span>'
        +(s.raw?'<span class="expand-hint">▸ 展开数据</span>':'')+'</div>'
        +(s.detail?'<div class="vstep-detail">'+s.detail+'</div>':'')
        +rawHtml+'</div></div>';
    }).join('');
    document.getElementById('verify-steps').innerHTML=html;

    document.querySelectorAll('.vstep').forEach(function(el){
      el.addEventListener('click', function(){
        var raw = this.querySelector('.vstep-raw');
        if(raw){ raw.classList.toggle('open'); var hint=this.querySelector('.expand-hint'); if(hint) hint.textContent=raw.classList.contains('open')?'▾ 收起':'▸ 展开数据'; }
      });
    });

    if(d.config){
      document.getElementById('verify-config').innerHTML=
        '<h3 style="margin-top:12px;margin-bottom:6px;font-size:11px;color:#8b949e;text-transform:uppercase">最终配置内容</h3>'
        +'<pre>'+JSON.stringify(d.config,null,2)+'</pre>';
    }
  }).catch(function(e){
    document.getElementById('verify-steps').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
  });
}

// ── Manual sign / verify ─────────────────────────────────────
function doManualSign(){
  var data = document.getElementById('ms-data').value;
  if(!data){ document.getElementById('ms-result').innerHTML='<div class="msg warn">请输入数据</div>'; return; }
  var privKey = document.getElementById('ms-priv').value || null;
  var body = { data:data };
  if(privKey) body.private_key = privKey;
  apiDev('POST','/dev/sign',body).then(function(d){
    document.getElementById('ms-result').innerHTML=
      '<div class="msg ok">✓ 签名成功（使用私钥: '+d.private_key_used+'）</div>'
      +'<div class="kv" style="margin-top:6px"><span class="kv-label">Signature</span>'
      +'<span class="kv-val" id="ms-sig-out" style="word-break:break-all">'+d.signature+'</span>'
      +'<button class="copy-btn" id="cp-ms-sig-out">复制</button></div>';
    document.getElementById('cp-ms-sig-out').addEventListener('click', function(){ copyEl('ms-sig-out'); });
    document.getElementById('mv-data').value = data;
    document.getElementById('mv-sig').value = d.signature;
    if(!document.getElementById('mv-pub').value && S.signPub) document.getElementById('mv-pub').value = S.signPub;
  }).catch(function(e){
    document.getElementById('ms-result').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
  });
}

function doManualVerify(){
  var data=document.getElementById('mv-data').value, sig=document.getElementById('mv-sig').value, pub=document.getElementById('mv-pub').value;
  if(!data||!sig||!pub){ document.getElementById('mv-result').innerHTML='<div class="msg warn">请填写数据、签名和公钥</div>'; return; }
  apiDev('POST','/dev/verify-sig',{data:data,signature:sig,public_key:pub}).then(function(d){
    document.getElementById('mv-result').innerHTML = d.valid
      ? '<div class="msg ok">✓ 签名有效</div>'
      : '<div class="msg err">✗ 签名无效'+(d.error?' — '+d.error:'')+'</div>';
  }).catch(function(e){
    document.getElementById('mv-result').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
  });
}

// ── Bind all events ──────────────────────────────────────────
document.getElementById('btn-init').addEventListener('click', doInit);
document.getElementById('btn-reinit').addEventListener('click', doInit);
document.getElementById('btn-submit').addEventListener('click', doSubmit);
document.getElementById('btn-refresh').addEventListener('click', loadPending);
document.getElementById('btn-sign-publish').addEventListener('click', doSignPublish);
document.getElementById('btn-verify').addEventListener('click', doVerify);
document.getElementById('btn-reset-json').addEventListener('click', function(){ document.getElementById('config-json').value=EXAMPLE; });
document.getElementById('btn-manual-sign').addEventListener('click', doManualSign);
document.getElementById('btn-manual-verify').addEventListener('click', doManualVerify);

document.getElementById('tab-btn-sign').addEventListener('click', function(){
  document.querySelectorAll('.tab,.tab-content').forEach(function(el){ el.classList.remove('active'); });
  document.getElementById('tab-sign').classList.add('active');
  this.classList.add('active');
});
document.getElementById('tab-btn-verify').addEventListener('click', function(){
  document.querySelectorAll('.tab,.tab-content').forEach(function(el){ el.classList.remove('active'); });
  document.getElementById('tab-verify').classList.add('active');
  this.classList.add('active');
});

['root-pub','root-priv','sign-id','sign-pub','sign-priv'].forEach(function(id){
  document.getElementById('cp-'+id).addEventListener('click', function(){ copyEl(id); });
});
['ps-hash','ps-sig'].forEach(function(id){
  document.getElementById('cp-'+id).addEventListener('click', function(){ copyEl(id); });
});
document.querySelectorAll('.kv-val.priv').forEach(function(el){
  el.addEventListener('click', function(){ this.classList.toggle('shown'); });
});

// Check status on load
apiDev('GET','/dev/status').then(function(d){
  if(d.initialized){
    document.getElementById('status-badge').textContent='服务有数据，需重新初始化获取密钥';
    document.getElementById('status-badge').className='bdg bdg-warn';
  }
}).catch(function(){});
</script>
</body>
</html>`;

export function createDevUiRoute(): Hono {
  const app = new Hono();
  app.get("/", (c) => {
    c.header("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
    return c.html(HTML);
  });
  return app;
}
