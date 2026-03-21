# PLAN-001 基于 ed25519 签名验证的发布系统架构设计

- **status**: draft
- **createdAt**: 2026-03-21 12:20
- **approvedAt**: (待审批)
- **relatedTask**: FEAT-001

## 现状

空项目，需从零设计一套服务端-客户端发布系统。核心需求：服务端管理一份统一的版本化配置文件，签名后发布；客户端内置 Root 公钥，验证后应用配置。含多用户审批流程。

## 方案

### 1. 核心模型：签名配置快照

不再使用消息流，改为**单一版本化配置文件**。每次发布即一个完整配置快照，子密钥签名，客户端拉取最新版本并全量应用。

```
┌─────────────────────────────────────────────────────────────┐
│                   PublishConfig v12                         │
│                                                            │
│  version: 12                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ update:                                             │   │
│  │   latest_version: "2.3.1"                           │   │
│  │   min_version: "2.0.0"                              │   │
│  │   download_url: "https://..."                       │   │
│  │   sha256: "a1b2c3..."                               │   │
│  │   release_notes: "..."                              │   │
│  │   force: false                                      │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ endpoints:                                          │   │
│  │   api: "https://api.example.com"                    │   │
│  │   ws: "wss://ws.example.com"                        │   │
│  │   cdn: "https://cdn.example.com"                    │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ features:                                           │   │
│  │   new_dashboard: true                               │   │
│  │   beta_search: false                                │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ announcements:                                      │   │
│  │   - id: "ann-001"                                   │   │
│  │     type: "banner"                                  │   │
│  │     content: "..."                                  │   │
│  │     expires_at: 1712000000                          │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ custom:                                             │   │
│  │   { arbitrary key-value for app-specific needs }    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  meta:                                                     │
│    key_id: "signing-2026-03"                               │
│    timestamp: 1711036800                                   │
│    signature: "base64..."                                  │
└─────────────────────────────────────────────────────────────┘
```

**对比消息流模型的优势**：

| 维度 | 消息流 | 配置快照 |
|------|--------|---------|
| 客户端状态管理 | 需合并多条消息、处理冲突 | 直接全量替换，无冲突 |
| 新客户端引导 | 需重放历史或 /current 端点 | 拉取最新版本即可 |
| 服务端复杂度 | 需维护序列号、分 action 查询 | 版本号自增，单一端点 |
| 审计追溯 | 每条消息独立审计 | 版本 diff 可追溯每次变更 |
| 部分更新 | 天然支持 | 每次发布完整快照（可只改一个 section） |

### 2. 整体架构

```
                        ┌─────────────────────────────────┐
                        │         Publish Server          │
                        │     (Bun + Hono + SQLite)       │
  Operator A ──┐        │                                 │
  Operator B ──┼──API──→│  ┌───────────┐  ┌────────────┐  │
  Operator C ──┘        │  │ Approval  │  │  Signing   │  │
                        │  │ Workflow  │  │  Service   │  │
                        │  └───────────┘  └────────────┘  │
                        │         │              │        │
                        │    ┌────┴────┐   ┌─────┴─────┐  │
                        │    │  Store  │   │ Key Vault │  │
                        │    │ SQLite  │   │ (Root +   │  │
                        │    │         │   │  Signing) │  │
                        │    └─────────┘   └───────────┘  │
                        └────────────┬────────────────────┘
                                     │
                          GET /v1/config/latest
                          GET /v1/keys
                                     │
                        ┌────────────┴────────────────────┐
                        │           Client                │
                        │   (内置 Root Public Key)         │
                        │                                 │
                        │   1. GET /v1/keys → Key List    │
                        │   2. 验证 Key List (Root 签名)   │
                        │   3. GET /v1/config/latest      │
                        │   4. 验证配置签名 (子密钥)        │
                        │   5. version > local? → 应用     │
                        └─────────────────────────────────┘
```

### 3. 两层密钥体系（不变）

#### Root Key（根密钥）

- **永不轮换**，客户端编译时嵌入 Root Public Key
- **唯一职责**：签名 Key List
- Root Private Key 离线保管（冷存储/HSM），不存在服务端

#### Key List（密钥清单）

Root Key 签名的信任清单：

```typescript
interface KeyList {
  version: number           // Key List 格式版本
  list_sequence: number     // 单调递增，防重放
  timestamp: number         // 发布时间
  expires_at: number        // 过期时间
  keys: SigningKeyEntry[]
  root_signature: string    // Root Key 对上述内容的签名
}

interface SigningKeyEntry {
  key_id: string
  public_key: string        // base64 ed25519 公钥
  status: "active" | "revoked"
  not_before: number
  not_after: number
  revoked_at?: number
}
```

**密钥泄露应对（不变）**：

| 泄露的密钥 | 应对措施 | 需要更新客户端 |
|-----------|---------|--------------|
| 子密钥 | 发布新 Key List 吊销 | 否 |
| Root Key | 发布新客户端版本 | 是（概率极低） |

### 4. Manifest + Config 分离模型

采用 **manifest 描述 + config 内容分离** 的设计。manifest 包含配置的 hash 和签名元数据，签名覆盖 manifest；config 是纯业务内容，通过 hash 校验完整性。

```
┌─────────────────────────── API Response ───────────────────────────┐
│                                                                    │
│  ┌──────────────── manifest ─────────────────┐                     │
│  │  version:        12                       │                     │
│  │  content_hash:   "sha256:a1b2c3..."       │ ← SHA-256 of config│
│  │  content_size:   1842                     │                     │
│  │  key_id:         "signing-2026-03"        │                     │
│  │  timestamp:      1711036800               │                     │
│  │  expires_at:     1711900000               │                     │
│  │  signature:      "base64..."              │ ← 签名覆盖 manifest │
│  └───────────────────────────────────────────┘                     │
│                                                                    │
│  ┌──────────────── config ───────────────────┐                     │
│  │  update: { latest_version, download_url } │                     │
│  │  endpoints: { api, ws, cdn }              │                     │
│  │  features: { new_dashboard: true }        │                     │
│  │  announcements: [ ... ]                   │                     │
│  │  custom: { ... }                          │                     │
│  └───────────────────────────────────────────┘                     │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**设计理由**：

| 维度 | 签名嵌入 config 内部 | manifest + config 分离 |
|------|---------------------|----------------------|
| 关注点 | 签名和业务混在一起 | 签名逻辑与业务内容解耦 |
| 签名对象 | 需要先剥离 meta 再签名 | 直接签名 manifest（含 content_hash） |
| 完整性校验 | 仅签名验证 | hash 校验 + 签名验证，双重保障 |
| 内容可寻址 | 无 | content_hash 天然可做缓存 key / 去重标识 |
| 向前兼容 | config 结构变化影响签名逻辑 | config 结构任意扩展，manifest 结构稳定 |
| 独立分发 | 不可 | manifest 和 config 可分开传输/存储 |

#### 4.1 Manifest 类型

```typescript
interface Manifest {
  /** 配置版本号，严格单调递增 */
  version: number
  /** config 内容的 SHA-256 hash（对 canonical JSON 计算） */
  content_hash: string            // "sha256:<hex>"
  /** config 内容的字节数 */
  content_size: number
  /** 签名子密钥 ID */
  key_id: string
  /** 签名时间戳 (Unix seconds) */
  timestamp: number
  /** 配置过期时间 (Unix seconds) */
  expires_at: number
  /** ed25519 签名，覆盖上述所有字段 */
  signature: string               // base64
}
```

#### 4.2 Config 类型（纯业务内容，无签名字段）

```typescript
interface Config {
  /** 版本更新信息 */
  update?: {
    latest_version: string
    min_version: string           // 低于此版本强制更新
    download_url: string
    sha256: string                // 下载文件的 hash
    release_notes?: string
    force?: boolean               // 强制立即更新
  }

  /** 服务端点配置 */
  endpoints?: {
    [name: string]: string        // api, ws, cdn, auth ...
  }

  /** 功能开关 */
  features?: {
    [flag: string]: boolean
  }

  /** 公告/广告/营销 */
  announcements?: Announcement[]

  /** 应用自定义扩展字段（任意 key-value） */
  custom?: Record<string, unknown>
}

interface Announcement {
  id: string
  type: "banner" | "popup" | "toast" | "fullscreen"
  title?: string
  content: string
  action_url?: string
  image_url?: string
  priority: number
  starts_at?: number
  expires_at: number
  display_rule?: "once" | "every_launch" | "daily"
  target_versions?: string        // semver range
}
```

#### 4.3 签名与验证

**签名流程（服务端发布时）**：

```
1. config_json = canonical_json(config)        // key 排序 + 无空白 + UTF-8
2. content_hash = "sha256:" + hex(SHA-256(config_json))
3. content_size = byte_length(config_json)
4. 构造 manifest（不含 signature 字段）
5. manifest_bytes = canonical_json(manifest_without_sig)
6. signature = ed25519_sign(private_key, manifest_bytes)
7. manifest.signature = base64(signature)
```

**验证流程（客户端收到时）**：

```
1. 从 manifest 提取 signature，剩余字段构造 manifest_without_sig
2. manifest_bytes = canonical_json(manifest_without_sig)
3. ed25519_verify(public_key, manifest_bytes, signature) → 真实性
4. config_json = canonical_json(config)
5. computed_hash = "sha256:" + hex(SHA-256(config_json))
6. assert computed_hash === manifest.content_hash     → 完整性
7. assert byte_length(config_json) === manifest.content_size → 一致性
```

**签名直接覆盖 manifest 的 canonical JSON**，不再需要自定义二进制格式。因为 manifest 结构稳定、字段固定，canonical JSON 足够确定性且易于跨语言实现。

#### 4.4 Canonical JSON 规范

```
规则：
1. 对象 key 按 Unicode 码点升序排列
2. 无多余空白（无缩进、无换行、无尾随空格）
3. 数字不含前导零、不含尾随零、不使用科学计数法
4. 字符串使用标准 JSON 转义
5. 编码为 UTF-8
```

示例：`{"content_hash":"sha256:a1b2","content_size":1842,"expires_at":1711900000,"key_id":"signing-2026-03","timestamp":1711036800,"version":12}`

### 5. 版本化语义

```
v1 → v2 → v3 → ... → v12 (当前)
│         │              │
│         │              └── 改了 endpoints.api 地址
│         └── 新增一条 announcement
└── 初始配置
```

**规则**：

- `version` 严格单调递增（每次发布 +1）
- 客户端仅接受 `version > local_version` 的配置
- 每个版本是**完整快照**，非增量 diff
- 服务端保留历史版本用于审计，但客户端只关心最新
- `version` 同时替代了原方案中的 `sequence`，简化为单一递增标识

### 6. 多用户审批流程

#### 角色

| 角色 | 权限 |
|------|------|
| `admin` | 管理用户、管理签名密钥、审批、发布 |
| `publisher` | 创建/编辑配置草稿、审批、发布 |
| `reviewer` | 仅审批，不能创建/发布 |

#### 配置版本生命周期

```
                    ┌─────────┐
                    │  draft  │ ← 基于当前已发布版本创建
                    └────┬────┘
                         │ submit
                    ┌────▼────────────┐
                    │ pending_review  │
                    └────┬──────┬─────┘
                approve  │      │ reject
                    ┌────▼──┐ ┌─▼───────┐
                    │approved│ │rejected │
                    └────┬───┘ └─────────┘
                         │ publish (签名)
                    ┌────▼─────┐
                    │published │ ← 客户端可拉取
                    └──────────┘
```

#### 审批规则

```typescript
interface ApprovalPolicy {
  min_approvals: number                // 最低审批人数（默认 2）
  require_different_from_author: true  // 审批人不能是创建者
  approval_timeout_hours: number       // 审批超时自动过期（默认 72h）
}
```

#### 创建草稿的方式

**基于当前已发布版本创建**：服务端自动复制最新 published config 为基础，操作员只修改需要变更的 section。这保证了每个版本都是完整快照，同时操作员只需关注 diff。

```
POST /v1/admin/configs
Body: { "base_version": 12, "changes": { "endpoints": { "api": "https://new-api.example.com" } } }

→ 服务端合并：base_version 的完整配置 + changes = 新草稿
→ 新草稿 version = 13 (auto increment)
```

### 7. API 设计

#### 公开 API（客户端调用，无需认证）

```
GET  /v1/keys                          # 获取 Root 签名的 Key List
GET  /v1/config/latest                 # 获取最新 manifest + config
GET  /v1/config/:version               # 获取指定版本（可选，调试用）
GET  /v1/config/latest/manifest        # 仅获取 manifest（轻量检查）
```

`GET /v1/config/latest` 响应：

```json
{
  "manifest": {
    "version": 12,
    "content_hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "content_size": 1842,
    "key_id": "signing-2026-03",
    "timestamp": 1711036800,
    "expires_at": 1711900000,
    "signature": "nMBnQ8GGo..."
  },
  "config": {
    "update": {
      "latest_version": "2.3.1",
      "min_version": "2.0.0",
      "download_url": "https://releases.example.com/v2.3.1/app",
      "sha256": "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
    },
    "endpoints": {
      "api": "https://api.example.com",
      "ws": "wss://ws.example.com",
      "cdn": "https://cdn.example.com"
    },
    "features": {
      "new_dashboard": true,
      "beta_search": false
    },
    "announcements": [
      {
        "id": "ann-001",
        "type": "banner",
        "content": "System maintenance scheduled",
        "expires_at": 1712000000,
        "priority": 1,
        "display_rule": "once"
      }
    ],
    "custom": {
      "poll_interval": 3600
    }
  }
}
```

`GET /v1/config/latest/manifest` 响应（仅 manifest，用于轻量版本检查）：

```json
{
  "manifest": {
    "version": 12,
    "content_hash": "sha256:e3b0c44...",
    "content_size": 1842,
    "key_id": "signing-2026-03",
    "timestamp": 1711036800,
    "expires_at": 1711900000,
    "signature": "nMBnQ8GGo..."
  }
}
```

**客户端轮询优化**：

```
1. GET /v1/config/latest/manifest          ← 轻量请求（~200 bytes）
2. manifest.version > local_version?
   - 否 → 结束，无更新
   - 是 → GET /v1/config/latest            ← 完整请求
3. 验证 manifest + config
```

也支持 `If-None-Match: "v12"` 和 `304 Not Modified`。

#### 管理 API（需认证）

```
# 用户管理
POST   /v1/admin/users                      # 创建用户
GET    /v1/admin/users                      # 列出用户

# 配置管理
POST   /v1/admin/configs                    # 创建新草稿（基于最新版本 + changes）
GET    /v1/admin/configs                    # 列出所有版本
GET    /v1/admin/configs/:version           # 查看指定版本详情（含审批记录）
PUT    /v1/admin/configs/:version           # 编辑草稿（仅 draft 状态）
GET    /v1/admin/configs/:version/diff      # 与前一版本的 diff
POST   /v1/admin/configs/:version/submit    # 提交审批
POST   /v1/admin/configs/:version/approve   # 审批通过
POST   /v1/admin/configs/:version/reject    # 审批拒绝
POST   /v1/admin/configs/:version/publish   # 签名发布

# 密钥管理
GET    /v1/admin/keys                       # 列出签名密钥
POST   /v1/admin/keys                       # 创建新签名密钥
POST   /v1/admin/keys/:id/revoke            # 吊销密钥
POST   /v1/admin/keys/publish-list          # 用 Root Key 签名并发布新 Key List
```

### 8. 客户端验证流程

```
┌─ 启动/定时轮询 ───────────────────────────────────────────────────┐
│                                                                   │
│  ① Key List 更新                                                   │
│     GET /v1/keys → 用内置 Root Public Key 验证 root_signature      │
│     list_sequence > local? → 更新本地密钥环                         │
│                                                                   │
│  ② 轻量版本检查                                                     │
│     GET /v1/config/latest/manifest                                │
│     manifest.version > local_version?                             │
│     否 → 结束（无更新）                                              │
│                                                                   │
│  ③ 拉取完整配置                                                     │
│     GET /v1/config/latest → 获取 { manifest, config }             │
│                                                                   │
│  ④ 验证真实性（签名）                                                │
│     a. manifest.key_id 在 Key List 中且 status=active?            │
│     b. manifest_without_sig = manifest 去掉 signature 字段        │
│     c. manifest_bytes = canonical_json(manifest_without_sig)      │
│     d. ed25519_verify(public_key, manifest_bytes, signature)?     │
│                                                                   │
│  ⑤ 验证完整性（hash）                                               │
│     a. config_json = canonical_json(config)                       │
│     b. computed = "sha256:" + hex(SHA-256(config_json))           │
│     c. computed === manifest.content_hash?                        │
│     d. byte_length(config_json) === manifest.content_size?        │
│                                                                   │
│  ⑥ 验证时效性                                                      │
│     a. manifest.expires_at > now?                                 │
│     b. manifest.version > local_version? (再次确认)                 │
│                                                                   │
│  ⑦ 全部通过 → 应用 config + 持久化 manifest + config               │
│     任一失败 → 拒绝，继续使用本地缓存                                 │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

**轮询策略**：
- 默认间隔：1 小时（可在 config.custom.poll_interval 中动态配置）
- 轻量检查（仅 manifest）开销极小（~200 bytes），可适当提高频率
- 服务端错误：指数退避 1h → 2h → 4h → max 24h
- 随机抖动 ±10%
- 应用启动时立即拉取

### 9. 项目结构

```
publish/
  package.json
  tsconfig.json
  src/
    core/                          # 共享类型与加密逻辑
      types.ts                     # Manifest, Config, KeyList, Announcement 类型
      signing.ts                   # ed25519 签名/验证 (@noble/ed25519)
      canonical.ts                 # canonical JSON 实现
      hash.ts                      # SHA-256 hash + content_hash 构建/校验
      keylist.ts                   # Key List 验证逻辑
      validation.ts                # manifest 验证：签名 + hash + 时效
    server/
      index.ts                     # Hono app 入口
      routes/
        public.ts                  # GET /v1/keys, /v1/config/latest
        admin/
          users.ts                 # 用户管理
          configs.ts               # 配置 CRUD + 审批 + 发布
          keys.ts                  # 签名密钥管理 + Key List 发布
      middleware/
        auth.ts                    # JWT 认证
        rbac.ts                    # 角色权限校验
      db/
        schema.ts                  # 表结构
        migrations/
        store.ts                   # 数据访问层
      services/
        approval.ts                # 审批流程
        publisher.ts               # 签名 + 发布
        keymanager.ts              # 密钥管理
    client/                        # 客户端库
      index.ts                     # PublishClient 入口
      poller.ts                    # 轮询、退避、抖动
      keyring.ts                   # 本地密钥环
      state.ts                     # 本地配置持久化
  test/
    core/
    server/
    client/
    e2e/
  docs/
```

### 10. 技术栈

| 用途 | 选择 | 理由 |
|------|------|------|
| 运行时 | Bun | 高性能、内置 SQLite、原生 TS |
| Web 框架 | Hono | 轻量、类型安全 |
| ed25519 | `@noble/ed25519` | 经审计、纯 JS、无 native 依赖 |
| 数据库 | `bun:sqlite` | 零依赖、单文件 |
| Schema 校验 | `zod` | 类型推导 + 运行时校验 |
| 认证 | `hono/jwt` | 管理 API 认证 |
| 测试 | `bun:test` | 内置、快速 |

### 11. 数据库 Schema

```sql
-- 用户表
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('admin', 'publisher', 'reviewer')),
  created_at    INTEGER DEFAULT (unixepoch())
);

-- 签名密钥表（子密钥，私钥在服务端）
CREATE TABLE signing_keys (
  key_id          TEXT PRIMARY KEY,
  public_key      TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
  not_before      INTEGER NOT NULL,
  not_after       INTEGER NOT NULL,
  created_at      INTEGER DEFAULT (unixepoch()),
  revoked_at      INTEGER
);

-- Key List 历史
CREATE TABLE key_lists (
  list_sequence  INTEGER PRIMARY KEY,
  content        TEXT NOT NULL,
  root_signature TEXT NOT NULL,
  published_at   INTEGER DEFAULT (unixepoch())
);

-- 配置版本表（核心表）
CREATE TABLE configs (
  version        INTEGER PRIMARY KEY,          -- 严格单调递增
  config_content TEXT NOT NULL,                 -- 完整 Config JSON
  content_hash   TEXT,                          -- "sha256:<hex>"（published 后填入）
  content_size   INTEGER,                       -- config canonical JSON 字节数
  author_id      TEXT NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL CHECK(status IN
    ('draft', 'pending_review', 'approved', 'published', 'rejected')),
  base_version   INTEGER,                      -- 基于哪个版本创建
  key_id         TEXT,                          -- 签名所用子密钥（published 后填入）
  signature      TEXT,                          -- manifest 签名（published 后填入）
  created_at     INTEGER DEFAULT (unixepoch()),
  submitted_at   INTEGER,
  approved_at    INTEGER,
  published_at   INTEGER
);

-- 审批记录
CREATE TABLE approvals (
  id          TEXT PRIMARY KEY,
  config_ver  INTEGER NOT NULL REFERENCES configs(version),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision    TEXT NOT NULL CHECK(decision IN ('approved', 'rejected')),
  comment     TEXT,
  created_at  INTEGER DEFAULT (unixepoch()),
  UNIQUE(config_ver, reviewer_id)
);

CREATE INDEX idx_configs_status ON configs(status);
CREATE INDEX idx_configs_published ON configs(status, version)
  WHERE status = 'published';
```

### 12. 容错与降级

| 故障场景 | 客户端行为 |
|---------|-----------|
| 服务端不可达 | 使用本地缓存配置 + Key List，指数退避 |
| Key List 签名无效 | 拒绝更新，继续用旧 Key List |
| 配置签名无效 | 拒绝，继续用本地配置 |
| key_id 不在 Key List 中 | 拒绝 |
| 配置过期 | 继续使用（但记录警告，因为可能是服务端未及时发布新版本） |
| 未知字段 | 忽略（向前兼容，JSON 天然支持） |
| 本地状态损坏 | 重置为编译时默认配置 + 重新拉取 |

**核心原则：客户端永远不能因发布系统故障而不可用。编译时默认配置是最终兜底。**

## 风险

1. **Root Key 泄露**：离线保管概率极低，但一旦泄露需发布新客户端
2. **Key List 发布流程**：需要安全的 Root Key 签名方式（离线签名 → 导入服务端）
3. **配置体积**：随着 announcements 增多可能膨胀，需设定上限或定期清理过期项
4. **审批流程绕过**：服务端必须强制校验，不能仅依赖前端

## 工作量

| 阶段 | 内容 |
|------|------|
| Phase 1 | `src/core/`：PublishConfig 类型、签名/验证、canonical JSON、Key List |
| Phase 2 | `src/server/`：DB schema、公开 API（/v1/config、/v1/keys） |
| Phase 3 | `src/server/`：管理 API、审批流程、用户认证、RBAC |
| Phase 4 | `src/client/`：轮询器、密钥环、状态管理 |
| Phase 5 | 测试、文档 |

## 备选方案

| 方案 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| 消息流（每个 action 独立消息） | 细粒度控制 | 客户端需合并状态、处理冲突、维护序列号 | 否决 |
| **版本化配置快照** | 无冲突、简单可靠、全量替换 | 每次发布完整快照（体积稍大但可忽略） | **采用** |

## 批注

### R1 (2026-03-21) - 用户反馈

1. 密钥管理改为 Root Key 签名 Key List 模式
2. 技术栈从 Rust 改为 TypeScript + Bun + Hono
3. 新增多用户审批流程

### R2 (2026-03-21) - 用户反馈

4. 从消息流模型改为统一版本化配置文件模型
   - 所有行为类型合并为一个配置文件的不同 section
   - `version` 单调递增替代 `sequence`
   - 每次发布为完整快照，客户端全量替换

### R3 (2026-03-21) - 用户反馈

5. 采用 manifest + config 分离模型
   - manifest 包含 content_hash (SHA-256)、content_size、签名元数据、signature
   - config 是纯业务内容，不含任何签名字段
   - 签名覆盖 manifest 的 canonical JSON（不再需要自定义二进制格式）
   - 客户端双重验证：签名验证真实性 + hash 验证完整性
   - 新增 `/v1/config/latest/manifest` 轻量端点，仅返回 manifest 用于版本检查
   - API 响应同时返回 `{ manifest, config }` 两个独立对象
