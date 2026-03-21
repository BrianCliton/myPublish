# publish — 任务清单

> 更新日期: 2026-03-21

## 使用规范

每个任务为单行链接，指向对应的详情文件 `docs/task/PREFIX-NNN.md`。

### 格式

- [ ] [**PREFIX-001 简短祈使句标题**](PREFIX-001.md) `P1`

### 状态标记

| 标记 | 含义 |
|------|------|
| `[ ]` | 待办 |
| `[-]` | 进行中 |
| `[x]` | 已完成 |
| `[~]` | 关闭/不做 |

### 优先级: P0 (阻塞) > P1 (高) > P2 (中) > P3 (低)

### 规则

- 仅更新复选框标记，禁止删除任务行。
- 新任务追加到列表末尾。
- 详细信息见各 `PREFIX-NNN.md` 文件。

---

## 任务

- [-] [**FEAT-001 设计并实现基于 ed25519 签名验证的发布系统**](FEAT-001.md) `P0`
- [x] [**FEAT-002 Implement core module (types, signing, canonical, hash)**](FEAT-002.md) `P0`
- [x] [**FEAT-003 Implement server public API (DB, /v1/keys, /v1/config)**](FEAT-003.md) `P0`
- [ ] [**FEAT-004 Implement server admin API (approval, auth, RBAC)**](FEAT-004.md) `P0`
- [-] [**FEAT-005 Implement client library (poller, keyring, state)**](FEAT-005.md) `P0`
- [ ] [**FEAT-006 E2E tests and documentation**](FEAT-006.md) `P1`
