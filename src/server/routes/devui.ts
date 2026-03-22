import { Hono } from "hono";

const EXAMPLE_CONFIG = JSON.stringify(
  {
    update: { latest_version: "2.6.0", min_version: "2.0.0", download_url: "https://cdn.example.com/releases/v2.6.0.pkg", sha256: "0000000011111111222222223333333344444444555555556666666677777777", release_notes: "新功能发布", force: false },
    features: { dark_mode: true, new_onboarding: true, payment_v2: true, analytics: true },
    endpoints: { api: "https://api.example.com/v3", cdn: "https://cdn.example.com", support: "https://support.example.com", website: "https://www.example.com" },
    announcements: [{ id: "ann-2025-02", type: "banner", title: "新版本发布", content: "v2.6.0 正式发布！", priority: 2, expires_at: 1780000000 }],
    custom: { security: { min_tls: "1.3", cert_pin: "sha256/XXXXYYYYZZZZZZZZ99999999XXXXXXXX" }, maintenance: { enabled: false, message: "" } },
  },
  null,
  2,
);

const HTML = `<!DOCTYPE html>
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
.sn{background:#21262d;color:#8b949e;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0}
.sn.active{background:#0d2149;color:#79c0ff}
.sn.done{background:#0d4429;color:#3fb950}
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
.vstep-raw{display:none;margin-top:6px;background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px;font-size:10px;color:#79c0ff;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow-y:auto}
.vstep-raw.open{display:block}
.expand-hint{color:#555;font-size:10px;margin-left:auto}
pre{background:#0d1117;border:1px solid #21262d;border-radius:5px;padding:10px;font-size:11px;overflow:auto;max-height:260px;color:#e6edf3;white-space:pre-wrap;word-break:break-word;margin-top:4px}
.msg{padding:7px 10px;border-radius:5px;font-size:12px;margin-top:6px}
.msg.ok{background:#0d4429;color:#3fb950;border:1px solid #238636}
.msg.err{background:#490202;color:#f85149;border:1px solid #da3633}
.msg.warn{background:#2d1c00;color:#ffa657;border:1px solid #9e4b00}
.msg.info{background:#0d2149;color:#79c0ff;border:1px solid #388bfd}
.msg.breaking{background:#2d0a0a;color:#f85149;border:2px solid #da3633;padding:10px}
.divider{border:none;border-top:1px solid #21262d;margin:14px 0}
.tabs{display:flex;gap:2px;margin-bottom:12px;background:#0d1117;padding:3px;border-radius:6px}
.tab{flex:1;text-align:center;padding:5px;border-radius:4px;cursor:pointer;font-size:12px;color:#8b949e;border:none;background:none;font-family:inherit}
.tab.active{background:#21262d;color:#e6edf3}
.tab-content{display:none}
.tab-content.active{display:block}
.row{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px}
.row label{color:#8b949e;font-size:11px;white-space:nowrap;padding-top:8px;min-width:72px}
.pending-item{background:#0d1117;border:1px solid #30363d;border-radius:5px;padding:10px;margin-bottom:8px}
.pending-header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.pending-actions{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center}
.diff-toggle{font-size:11px;color:#555;cursor:pointer;padding:2px 8px;border:1px solid #30363d;border-radius:4px;background:none;font-family:inherit}
.diff-toggle:hover{color:#8b949e;border-color:#555}
.diff-area{display:none;margin-top:8px}
.diff-area.open{display:block}
.diff-table{width:100%;border-collapse:collapse;font-size:11px}
.diff-table th{color:#555;padding:4px 6px;border-bottom:1px solid #21262d;text-align:left;font-weight:normal;font-size:10px;text-transform:uppercase;white-space:nowrap}
.diff-table td{padding:4px 6px;border-bottom:1px solid #0d1117;vertical-align:top;font-size:11px}
.dt-path{color:#79c0ff;font-family:monospace;white-space:nowrap}
.dt-val{color:#c9d1d9;max-width:180px;word-break:break-all}
.dt-old{color:#f85149;max-width:140px;word-break:break-all}
.dt-new{color:#3fb950;max-width:140px;word-break:break-all}
.dt-type{white-space:nowrap;font-size:10px}
.diff-added td{background:rgba(35,134,54,.08)}
.diff-removed td{background:rgba(218,54,51,.08)}
.diff-modified td{background:rgba(158,75,0,.10)}
.preview-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
.preview-table td{padding:3px 6px;border-bottom:1px solid #0d1117;vertical-align:top}
.pt-path{color:#8b949e;font-family:monospace;font-size:10px;white-space:nowrap}
.pt-val{color:#e6edf3;word-break:break-all}
.pt-changed{background:rgba(158,75,0,.15)}
.pt-added{background:rgba(35,134,54,.12)}
.confirm-row{display:flex;align-items:center;gap:8px;padding:8px;background:#2d0a0a;border:1px solid #da3633;border-radius:5px;margin:8px 0}
.confirm-row input[type=checkbox]{width:16px;height:16px;cursor:pointer;accent-color:#da3633}
.confirm-row label{color:#f85149;font-size:12px;cursor:pointer}
</style>
</head>
<body>
<header>
  <h1>Publish Dev UI</h1>
  <span class="bdg bdg-dev">DEV ONLY</span>
  <span id="status-badge" class="bdg bdg-no">未初始化</span>
</header>

<main>
<div class="panel">
  <h2>服务端（完整发布流程）</h2>

  <!-- STEP 0: INIT -->
  <div class="card">
    <div class="card-title"><span class="sn" id="sn0">0</span>初始化</div>
    <p class="hint">自动创建密钥对、发布方/审核方账户，并预置真实测试场景（v1 已发布，v2 待审核）</p>
    <div style="display:flex;gap:6px">
      <button id="btn-init">一键初始化</button>
      <button class="sec" id="btn-reinit">重新初始化</button>
    </div>
    <div id="init-msg"></div>
  </div>

  <!-- KEYS CARD -->
  <div class="card" id="keys-card" style="display:none">
    <div class="card-title">密钥信息（私钥点击显示）</div>
    <h3>根密钥对 — 签名 KeyList（生产永远离线保存）</h3>
    <div class="kv"><span class="kv-label">根公钥</span><span class="kv-val" id="root-pub"></span><button class="copy-btn" id="cp-root-pub">复制</button></div>
    <div class="kv"><span class="kv-label">根私钥</span><span class="kv-val priv" id="root-priv">点击显示</span><button class="copy-btn" id="cp-root-priv">复制</button></div>
    <h3>签名密钥对 — 签名每个 Manifest（可撤销轮换）</h3>
    <div class="kv"><span class="kv-label">Key ID</span><span class="kv-val" id="sign-id"></span><button class="copy-btn" id="cp-sign-id">复制</button></div>
    <div class="kv"><span class="kv-label">签名公钥</span><span class="kv-val" id="sign-pub"></span><button class="copy-btn" id="cp-sign-pub">复制</button></div>
    <div class="kv"><span class="kv-label">签名私钥</span><span class="kv-val priv" id="sign-priv">点击显示</span><button class="copy-btn" id="cp-sign-priv">复制</button></div>
  </div>

  <hr class="divider">

  <!-- STEP 1: WRITE & SUBMIT -->
  <div class="card">
    <div class="card-title"><span class="sn" id="sn1">1</span>发布方：写配置 → 提交审核</div>
    <p class="hint">编辑 JSON 配置后提交。<strong style="color:#79c0ff">提示：初始化已预置 v2 待审核，可直接跳到第 2 步体验审核流程。</strong></p>
    <textarea id="config-json" rows="9">${EXAMPLE_CONFIG}</textarea>
    <div style="margin-top:8px;display:flex;gap:6px">
      <button id="btn-submit">提交审核</button>
      <button class="sec" id="btn-reset-json">重置示例</button>
    </div>
    <div id="submit-msg"></div>
  </div>

  <!-- STEP 2: REVIEW -->
  <div class="card">
    <div class="card-title"><span class="sn" id="sn2">2</span>审核方：逐字段审核配置变更</div>
    <p class="hint">展开每条记录查看字段级变更，红色为 Breaking Change，需重点关注</p>
    <button class="sec" id="btn-refresh">刷新待审列表</button>
    <div id="pending-list" style="margin-top:8px">
      <div style="color:#555;font-size:12px;padding:8px 0">暂无待审核配置</div>
    </div>
  </div>

  <!-- STEP 3: PREVIEW & PUBLISH -->
  <div class="card" id="publish-section" style="display:none;border-color:#388bfd">
    <div class="card-title"><span class="sn active" id="sn3">3</span>签名前完整预览 & 发布</div>
    <p class="hint">版本 <strong id="approved-ver" style="color:#79c0ff"></strong> 已通过审核</p>
    <div id="preview-loading" style="color:#555;font-size:12px">加载预览中...</div>
    <div id="preview-content" style="display:none">
      <div id="breaking-warn" style="display:none"></div>
      <h3>所有字段完整预览（黄色=修改，绿色=新增）</h3>
      <div id="full-preview-table"></div>
      <h3 style="margin-top:12px">本次变更摘要</h3>
      <div id="preview-diff-table"></div>
      <div id="schema-errors" style="display:none"></div>
      <div id="confirm-area" style="margin-top:10px">
        <div id="breaking-confirm" style="display:none" class="confirm-row">
          <input type="checkbox" id="confirm-breaking">
          <label for="confirm-breaking">我已知晓以上 Breaking Change，确认继续签名发布</label>
        </div>
        <div style="margin-top:8px">
          <button class="blue" id="btn-sign-publish" disabled>签名发布</button>
        </div>
        <div id="pub-msg"></div>
      </div>
    </div>
  </div>

  <!-- SIGNING STEPS -->
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
      <div class="card-title">④ Ed25519 签名（签名私钥）</div>
      <div class="kv"><span class="kv-label">Signature</span><span class="kv-val" id="ps-sig"></span><button class="copy-btn" id="cp-ps-sig">复制</button></div>
    </div>
    <div class="card" style="border-color:#388bfd">
      <div class="card-title" style="color:#79c0ff">⑤ 客户端收到的完整数据包（GET /v1/config/latest）</div>
      <p class="hint">含签名后的 manifest + 配置正文，客户端验签后才信任</p>
      <pre id="ps-client-json" style="max-height:380px"></pre>
    </div>
  </div>

  <hr class="divider">

  <!-- MANUAL SIGN / VERIFY -->
  <div class="card">
    <div class="card-title">底层密码学工具</div>
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

<!-- RIGHT PANEL: CLIENT VERIFY -->
<div class="panel">
  <h2>客户端（验证方）</h2>
  <p class="hint">模拟客户端拉取最新配置并逐步验证完整信任链（点击每步可展开原始数据）</p>
  <button id="btn-verify">拉取并验证</button>
  <div id="verify-steps" style="margin-top:12px"></div>
  <div id="verify-config"></div>
</div>
</main>

<script>
var S = { publisherToken:null, reviewerToken:null, signPub:null, signPriv:null, approvedVersion:null };
var EXAMPLE = ${JSON.stringify(EXAMPLE_CONFIG)};

// ── API ──────────────────────────────────────────────────────
function apiWith(token, method, path, body) {
  var h = {'Content-Type':'application/json'};
  if (token) h['Authorization'] = 'Bearer ' + token;
  return fetch(path, { method:method, headers:h, body:body?JSON.stringify(body):undefined })
    .then(function(r){ return r.json().then(function(d){ if(!r.ok) throw new Error(d.error||r.statusText); return d; }); });
}
function apiPub(m,p,b){ return apiWith(S.publisherToken,m,p,b); }
function apiRev(m,p,b){ return apiWith(S.reviewerToken,m,p,b); }
function apiDev(m,p,b){ return apiWith(null,m,p,b); }

// ── Helpers ──────────────────────────────────────────────────
function setKV(id,v){ var el=document.getElementById(id); el.textContent=v; el.dataset.val=v; }
function setKVBlur(id,v){ var el=document.getElementById(id); el.textContent=v; el.dataset.val=v; el.classList.add('priv'); el.classList.remove('shown'); }
function copyEl(id){ var el=document.getElementById(id); navigator.clipboard.writeText(el.dataset.val||el.textContent).then(function(){ el.style.outline='1px solid #3fb950'; setTimeout(function(){ el.style.outline=''; },800); }); }
function markSN(n,s){ var el=document.getElementById('sn'+n); el.className='sn'+(s==='done'?' done':s==='active'?' active':''); el.textContent=s==='done'?'✓':n; }

function fmtVal(v) {
  if (v === undefined) return '<span style="color:#555">(无)</span>';
  if (v === null) return '<span style="color:#555">null</span>';
  if (typeof v === 'object') return Array.isArray(v) ? '<span style="color:#8b949e">['+v.length+' 项]</span>' : '<span style="color:#8b949e">{...}</span>';
  var s = String(v);
  if (s.length > 60) s = s.substring(0,60)+'...';
  return '<span>'+s+'</span>';
}

// ── Client-side diff ─────────────────────────────────────────
function diffObj(a, b, path, out) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  var aObj = typeof a==='object' && a!==null && !Array.isArray(a);
  var bObj = typeof b==='object' && b!==null && !Array.isArray(b);
  if (aObj && bObj) {
    Object.keys(a).forEach(function(k) {
      var p = path ? path+'.'+k : k;
      if (!(k in b)) out.push({path:p,type:'removed',oldVal:a[k],breaking:true});
      else diffObj(a[k],b[k],p,out);
    });
    Object.keys(b).forEach(function(k) {
      if (!(k in a)) { var p=path?path+'.'+k:k; out.push({path:p,type:'added',newVal:b[k],breaking:false}); }
    });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    var len = Math.max(a.length,b.length);
    for (var i=0;i<len;i++) {
      var p = path+'['+i+']';
      if (i>=a.length) out.push({path:p,type:'added',newVal:b[i],breaking:false});
      else if (i>=b.length) out.push({path:p,type:'removed',oldVal:a[i],breaking:true});
      else diffObj(a[i],b[i],p,out);
    }
    return;
  }
  out.push({path:path,type:'modified',oldVal:a,newVal:b,breaking:typeof a!==typeof b});
}
function computeDiff(a,b){ var out=[]; diffObj(a,b,'',out); return out; }

function renderDiffTable(entries) {
  if (!entries.length) return '<div style="color:#555;font-size:11px;padding:6px 0">本次无变更</div>';
  var breaking = entries.filter(function(e){return e.breaking;});
  var header = breaking.length
    ? '<div class="msg warn" style="margin-bottom:8px;font-size:11px">⚠ 包含 '+breaking.length+' 项 Breaking Change（字段删除或类型变更），请重点审核</div>'
    : '';
  var rows = entries.map(function(e) {
    var cls = e.type==='added'?'diff-added':e.type==='removed'?'diff-removed':'diff-modified';
    var typeStr = e.type==='added'?'<span style="color:#3fb950">+ 新增</span>':e.type==='removed'?'<span style="color:#f85149">✗ 删除</span>'+'<span style="color:#f85149;font-size:10px"> Breaking</span>':'<span style="color:#ffa657">~ 修改</span>'+(e.breaking?'<span style="color:#f85149;font-size:10px"> Breaking</span>':'');
    var oldStr = e.type==='added' ? '<span style="color:#555">—</span>' : fmtVal(e.oldVal);
    var newStr = e.type==='removed' ? '<span style="color:#555">—</span>' : fmtVal(e.newVal);
    return '<tr class="'+cls+'"><td class="dt-type">'+typeStr+'</td><td class="dt-path">'+e.path+'</td><td class="dt-old">'+oldStr+'</td><td style="color:#555;padding:0 4px">→</td><td class="dt-new">'+newStr+'</td></tr>';
  }).join('');
  return header+'<table class="diff-table"><thead><tr><th>变更</th><th>字段路径</th><th>原值</th><th></th><th>新值</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function flattenForPreview(obj, prefix, changed) {
  var rows = [];
  if (typeof obj !== 'object' || obj === null) { rows.push({path:prefix,val:obj}); return rows; }
  if (Array.isArray(obj)) {
    obj.forEach(function(v,i){ rows = rows.concat(flattenForPreview(v, prefix+'['+i+']', changed)); });
    return rows;
  }
  Object.keys(obj).forEach(function(k) {
    rows = rows.concat(flattenForPreview(obj[k], prefix?prefix+'.'+k:k, changed));
  });
  return rows;
}
function renderFullPreview(config, diffEntries) {
  var changedPaths = {};
  diffEntries.forEach(function(e){ changedPaths[e.path] = e.type; });
  var flat = flattenForPreview(config, '', changedPaths);
  var rows = flat.map(function(r) {
    var ct = changedPaths[r.path];
    var cls = ct==='added'?'pt-added':ct==='modified'?'pt-changed':'';
    var tag = ct==='added'?' <span style="color:#3fb950;font-size:10px">NEW</span>':ct==='modified'?' <span style="color:#ffa657;font-size:10px">CHG</span>':'';
    return '<tr class="'+cls+'"><td class="pt-path">'+r.path+tag+'</td><td class="pt-val">'+fmtVal(r.val)+'</td></tr>';
  }).join('');
  return '<table class="preview-table"><tbody>'+rows+'</tbody></table>';
}

// ── Init ─────────────────────────────────────────────────────
function doInit() {
  apiDev('POST','/dev/init').then(function(d) {
    S.publisherToken = d.publisher_token;
    S.reviewerToken  = d.reviewer_token;
    S.signPub = d.signing_public_key;
    S.signPriv = d.signing_private_key;

    document.getElementById('status-badge').textContent='已就绪';
    document.getElementById('status-badge').className='bdg bdg-ok';
    document.getElementById('init-msg').innerHTML=
      '<div class="msg ok">✓ 初始化成功</div>'
      +'<div class="msg info" style="margin-top:6px">'
      +'📋 已预置测试场景：<br>'
      +'· <strong>v'+d.seeded.published_version+'</strong> 已发布（客户端当前使用的版本）<br>'
      +'· <strong>v'+d.seeded.pending_version+'</strong> 待审核（紧急安全更新，含 16 项变更）<br>'
      +'→ 直接点第 2 步「刷新待审列表」查看变更详情</div>';

    setKV('root-pub', d.root_public_key);
    setKVBlur('root-priv', d.root_private_key);
    setKV('sign-id', d.signing_key_id);
    setKV('sign-pub', d.signing_public_key);
    setKVBlur('sign-priv', d.signing_private_key);
    document.getElementById('keys-card').style.display='block';
    document.getElementById('mv-pub').value = d.signing_public_key;

    markSN(0,'done'); markSN(1,'active');
    loadPending();
  }).catch(function(e){
    document.getElementById('init-msg').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
  });
}

// ── Submit ────────────────────────────────────────────────────
function doSubmit() {
  if (!S.publisherToken) { document.getElementById('submit-msg').innerHTML='<div class="msg warn">⚠ 请先初始化</div>'; return; }
  var json;
  try { json = JSON.parse(document.getElementById('config-json').value); }
  catch(e) { document.getElementById('submit-msg').innerHTML='<div class="msg err">✗ JSON 格式错误: '+e.message+'</div>'; return; }

  apiPub('POST','/v1/admin/configs',{changes:json})
    .then(function(d){ return apiPub('POST','/v1/admin/configs/'+d.version+'/submit'); })
    .then(function(d){
      document.getElementById('submit-msg').innerHTML='<div class="msg info">↑ 已提交审核 version='+d.version+'</div>';
      markSN(1,'done'); markSN(2,'active');
      loadPending();
    })
    .catch(function(e){ document.getElementById('submit-msg').innerHTML='<div class="msg err">✗ '+e.message+'</div>'; });
}

// ── Pending list ──────────────────────────────────────────────
function loadPending() {
  apiPub('GET','/v1/admin/configs').then(function(all) {
    var active = all.filter(function(c){ return c.status==='pending_review'||c.status==='approved'; });
    var el = document.getElementById('pending-list');
    if (!active.length) { el.innerHTML='<div style="color:#555;font-size:12px;padding:8px 0">暂无待处理配置</div>'; return; }
    el.innerHTML = '';
    active.forEach(function(cfg) {
      var item = document.createElement('div');
      item.className = 'pending-item';
      var statusColor = cfg.status==='approved'?'#3fb950':'#ffa657';
      item.innerHTML =
        '<div class="pending-header">'
        +'<span style="color:#e6edf3;font-weight:500">version '+cfg.version+'</span>'
        +'<span class="bdg" style="background:#0d1117;color:'+statusColor+';border-color:'+statusColor+'">'+cfg.status+'</span>'
        +(cfg.base_version?'<span style="color:#555;font-size:11px">基于 v'+cfg.base_version+'</span>':'')
        +'</div>';

      var actions = document.createElement('div');
      actions.className = 'pending-actions';

      // Toggle diff button
      var btnDiff = document.createElement('button');
      btnDiff.className='diff-toggle'; btnDiff.textContent='▸ 查看字段变更';
      var diffArea = document.createElement('div');
      diffArea.className='diff-area'; diffArea.innerHTML='<div style="color:#555;font-size:11px">加载中...</div>';
      var diffLoaded = false;
      btnDiff.addEventListener('click', function(){
        diffArea.classList.toggle('open');
        btnDiff.textContent = diffArea.classList.contains('open') ? '▾ 收起变更' : '▸ 查看字段变更';
        if (diffArea.classList.contains('open') && !diffLoaded) {
          diffLoaded = true;
          apiDev('GET','/dev/configs/'+cfg.version+'/preview').then(function(p){
            diffArea.innerHTML = renderDiffTable(p.diff);
          }).catch(function(e){ diffArea.innerHTML='<div class="msg err">'+e.message+'</div>'; });
        }
      });
      actions.appendChild(btnDiff);

      if (cfg.status==='pending_review') {
        var btnA=document.createElement('button'); btnA.className='approve'; btnA.textContent='✓ 通过';
        btnA.addEventListener('click', function(){ doApprove(cfg.version); });
        var btnR=document.createElement('button'); btnR.className='reject'; btnR.textContent='✗ 拒绝';
        btnR.addEventListener('click', function(){ doReject(cfg.version); });
        actions.appendChild(btnA); actions.appendChild(btnR);
      }
      if (cfg.status==='approved') {
        var btnP=document.createElement('button'); btnP.className='blue'; btnP.textContent='签名发布';
        btnP.addEventListener('click', function(){ loadPublishPreview(cfg.version); });
        actions.appendChild(btnP);
      }

      item.appendChild(actions);
      item.appendChild(diffArea);
      el.appendChild(item);
    });
  }).catch(function(e){
    document.getElementById('pending-list').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
  });
}

function doApprove(version) {
  apiRev('POST','/v1/admin/configs/'+version+'/approve').then(function(d){
    if (d.status==='approved'||d.auto_approved) {
      markSN(2,'done'); markSN(3,'active');
      loadPublishPreview(version);
    }
    loadPending();
  }).catch(function(e){ alert('审批失败: '+e.message); });
}
function doReject(version) {
  apiRev('POST','/v1/admin/configs/'+version+'/reject',{comment:'dev rejected'}).then(function(){
    loadPending();
  }).catch(function(e){ alert('拒绝失败: '+e.message); });
}

// ── Publish preview ───────────────────────────────────────────
function loadPublishPreview(version) {
  S.approvedVersion = version;
  document.getElementById('approved-ver').textContent = version;
  document.getElementById('publish-section').style.display='block';
  document.getElementById('preview-loading').style.display='block';
  document.getElementById('preview-content').style.display='none';
  document.getElementById('btn-sign-publish').disabled=true;
  document.getElementById('publish-section').scrollIntoView({behavior:'smooth',block:'start'});

  apiDev('GET','/dev/configs/'+version+'/preview').then(function(p){
    document.getElementById('preview-loading').style.display='none';
    document.getElementById('preview-content').style.display='block';

    // Schema errors
    var schemaEl = document.getElementById('schema-errors');
    if (!p.validation.valid && p.validation.errors.length) {
      schemaEl.style.display='block';
      schemaEl.innerHTML='<div class="msg err"><strong>Schema 校验失败：</strong><br>'+p.validation.errors.join('<br>')+'</div>';
    } else { schemaEl.style.display='none'; }

    // Full field preview
    document.getElementById('full-preview-table').innerHTML = renderFullPreview(p.config, p.diff);

    // Diff summary
    document.getElementById('preview-diff-table').innerHTML = renderDiffTable(p.diff);

    // Breaking changes
    var bw = document.getElementById('breaking-warn');
    var bc = document.getElementById('breaking-confirm');
    var btnSign = document.getElementById('btn-sign-publish');
    if (p.breaking_changes.length) {
      bw.style.display='block';
      bw.innerHTML='<div class="msg breaking">🚨 <strong>检测到 '+p.breaking_changes.length+' 项 Breaking Change</strong><br>'
        +p.breaking_changes.map(function(e){return '· '+e.path+'（'+e.type+'）';}).join('<br>')
        +'<br><br>Breaking Change 可能导致旧版本客户端出现异常，请确认已做好兼容处理。</div>';
      bc.style.display='flex';
      btnSign.disabled=true;
      document.getElementById('confirm-breaking').addEventListener('change', function(){
        btnSign.disabled = !this.checked;
      });
    } else {
      bw.style.display='none'; bc.style.display='none';
      btnSign.disabled = !p.validation.valid;
    }
  }).catch(function(e){
    document.getElementById('preview-loading').innerHTML='<div class="msg err">✗ 加载预览失败: '+e.message+'</div>';
  });
}

// ── Sign & Publish ─────────────────────────────────────────────
function doSignPublish() {
  if (!S.approvedVersion) return;
  document.getElementById('btn-sign-publish').disabled=true;
  apiDev('POST','/dev/sign-publish/'+S.approvedVersion).then(function(d){
    document.getElementById('pub-msg').innerHTML='<div class="msg ok">✓ 已发布 version='+d.version+'</div>';
    markSN(3,'done');

    var ps = d.steps;
    document.getElementById('pub-steps').style.display='block';
    document.getElementById('ps-canonical').textContent = ps.canonical_json;
    setKV('ps-hash', ps.content_hash);
    document.getElementById('ps-size').textContent = ps.content_size+' 字节';
    document.getElementById('ps-unsigned').textContent = JSON.stringify(ps.unsigned_manifest,null,2);
    setKV('ps-sig', ps.signature);
    document.getElementById('ps-client-json').textContent = JSON.stringify(d.client_payload,null,2);

    document.getElementById('mv-sig').value = ps.signature;
    document.getElementById('mv-data').value = JSON.stringify(ps.unsigned_manifest);
    document.getElementById('pub-steps').scrollIntoView({behavior:'smooth',block:'start'});
  }).catch(function(e){
    document.getElementById('pub-msg').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
    document.getElementById('btn-sign-publish').disabled=false;
  });
}

// ── Verify (right panel) ──────────────────────────────────────
function doVerify() {
  document.getElementById('verify-steps').innerHTML='<div style="color:#8b949e;font-size:12px;padding:8px 0">验证中...</div>';
  document.getElementById('verify-config').innerHTML='';
  apiDev('GET','/dev/verify').then(function(d){
    var html = d.steps.map(function(s){
      var raw = s.raw ? '<div class="vstep-raw">'+JSON.stringify(s.raw,null,2)+'</div>' : '';
      return '<div class="vstep '+(s.ok?'pass':'fail')+'">'
        +'<span class="vstep-icon">'+(s.ok?'✓':'✗')+'</span>'
        +'<div style="flex:1"><div style="display:flex;align-items:center"><span class="vstep-name">'+s.name+'</span>'
        +(s.raw?'<span class="expand-hint">▸ 展开</span>':'')+'</div>'
        +(s.detail?'<div class="vstep-detail">'+s.detail+'</div>':'')
        +raw+'</div></div>';
    }).join('');
    document.getElementById('verify-steps').innerHTML = html;
    document.querySelectorAll('.vstep').forEach(function(el){
      el.addEventListener('click', function(){
        var r=this.querySelector('.vstep-raw'); if(!r) return;
        r.classList.toggle('open');
        var h=this.querySelector('.expand-hint'); if(h) h.textContent=r.classList.contains('open')?'▾ 收起':'▸ 展开';
      });
    });
    if (d.config) {
      document.getElementById('verify-config').innerHTML=
        '<h3 style="margin-top:12px;margin-bottom:6px;font-size:11px;color:#8b949e;text-transform:uppercase">客户端最终使用的配置</h3>'
        +'<pre>'+JSON.stringify(d.config,null,2)+'</pre>';
    }
  }).catch(function(e){
    document.getElementById('verify-steps').innerHTML='<div class="msg err">✗ '+e.message+'</div>';
  });
}

// ── Manual sign / verify ──────────────────────────────────────
function doManualSign() {
  var data=document.getElementById('ms-data').value;
  if(!data){ document.getElementById('ms-result').innerHTML='<div class="msg warn">请输入数据</div>'; return; }
  var privKey=document.getElementById('ms-priv').value||null;
  var body={data:data}; if(privKey) body.private_key=privKey;
  apiDev('POST','/dev/sign',body).then(function(d){
    document.getElementById('ms-result').innerHTML=
      '<div class="msg ok">✓ 签名成功（使用私钥: '+d.private_key_used+'）</div>'
      +'<div class="kv" style="margin-top:6px"><span class="kv-label">Signature</span>'
      +'<span class="kv-val" id="ms-sig-out">'+d.signature+'</span>'
      +'<button class="copy-btn" id="cp-ms-sig-out">复制</button></div>';
    document.getElementById('cp-ms-sig-out').addEventListener('click', function(){ copyEl('ms-sig-out'); });
    document.getElementById('mv-data').value=data;
    document.getElementById('mv-sig').value=d.signature;
    if(!document.getElementById('mv-pub').value && S.signPub) document.getElementById('mv-pub').value=S.signPub;
  }).catch(function(e){ document.getElementById('ms-result').innerHTML='<div class="msg err">✗ '+e.message+'</div>'; });
}
function doManualVerify() {
  var data=document.getElementById('mv-data').value, sig=document.getElementById('mv-sig').value, pub=document.getElementById('mv-pub').value;
  if(!data||!sig||!pub){ document.getElementById('mv-result').innerHTML='<div class="msg warn">请填写数据、签名和公钥</div>'; return; }
  apiDev('POST','/dev/verify-sig',{data:data,signature:sig,public_key:pub}).then(function(d){
    document.getElementById('mv-result').innerHTML=d.valid
      ? '<div class="msg ok">✓ 签名有效</div>'
      : '<div class="msg err">✗ 签名无效'+(d.error?' — '+d.error:'')+'</div>';
  }).catch(function(e){ document.getElementById('mv-result').innerHTML='<div class="msg err">✗ '+e.message+'</div>'; });
}

// ── Bind events ───────────────────────────────────────────────
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
  document.getElementById('tab-sign').classList.add('active'); this.classList.add('active');
});
document.getElementById('tab-btn-verify').addEventListener('click', function(){
  document.querySelectorAll('.tab,.tab-content').forEach(function(el){ el.classList.remove('active'); });
  document.getElementById('tab-verify').classList.add('active'); this.classList.add('active');
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

apiDev('GET','/dev/status').then(function(d){
  if(d.initialized){ document.getElementById('status-badge').textContent='服务有数据，需重新初始化'; document.getElementById('status-badge').className='bdg bdg-warn'; }
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
