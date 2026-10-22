# 视频片段标注平台

面向多租户的机器人示教视频片段标注 Demo：管理员发布任务并按天统计有效工作量，标注员领取任务、在视频上标出有效时间段（可附备注说明这一段在做什么）并提交。

## 技术栈

- Next.js 16（App Router）+ TypeScript + Tailwind CSS v4
- shadcn/ui（当前默认 `base-nova` preset，基于 Base UI）
- Supabase：Postgres、Auth、RLS、RPC

## 快速开始

### 1. 配置 Supabase

1. 在 [Supabase](https://supabase.com/dashboard) 创建项目。
2. 在 Project Settings → API Keys 复制 **Project URL** 和 **Publishable key**（或 Legacy anon key），写入 `.env` 或 `.env.local`：

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
```

3. 复制 **service_role key**（Legacy API keys 里），仅供 seed 脚本使用，不要加 `NEXT_PUBLIC_` 前缀：

```env
SUPABASE_SERVICE_ROLE_KEY=...
```

4. 打开 Supabase Dashboard → SQL Editor，按文件名顺序执行 [`supabase/migrations`](supabase/migrations) 下的 SQL；如果之前已执行过没有备注字段的旧版 0001，补跑 [0002_segment_notes.sql](supabase/migrations/0002_segment_notes.sql) 即可。

### 2. 写入演示数据

```bash
npm run seed
```

重复执行会**重置** 6 个演示任务及其片段。

### 3. 启动

```bash
npm run dev
```

打开 http://localhost:3000。

## 演示账号

统一密码：`demo123456`

| 账号 | 角色 | 租户 |
| --- | --- | --- |
| admin@demo.com | 全局管理员 | — |
| alice@demo.com | 标注员 | 星海机器人 |
| bob@demo.com | 标注员 | 星海机器人 |
| carol@demo.com | 标注员 | 远山数据 |

seed 预置了待领取、标注中（草稿）和已提交任务，打开管理员统计页即可看到按天的有效时长。

## 演示路径

1. 用 `admin@demo.com` 登录，在任务管理页发布一个新任务，选择租户和示例视频。
2. 用 `bob@demo.com` 登录，领取任务或继续已有的草稿任务，在视频上打点、保存草稿、提交。
3. 回到管理员账号，在「工作量统计」查看按天汇总的有效时长，页面还提供按标注员分组和提交明细；点击任务名可进入任务详情，查看每个已提交任务的时间段列表和备注。
4. 用 `carol@demo.com` 登录，任务列表只会出现「远山数据」的任务，验证租户隔离。

## 规则如何落地

- **时间段不重叠**：前端校验 + `save_task_segments` RPC 校验 + Postgres 排他约束 `segments_no_overlap` 三层保障。
- **有效时长**：只汇总 `submitted` 任务的片段，`sum(end_ms - start_ms)`；草稿不计入。
- **归日**：按 `submitted_at` 换算成 `Asia/Shanghai` 时区后的日期统计。
- **任务领取**：`claim_task` RPC 用单条 `UPDATE ... WHERE status = 'unassigned'` 原子抢占，避免并发重复领取。
- **租户隔离**：RLS 通过 `auth.uid()` 反查 `profiles.tenant_id` 限制标注员的读写范围；管理员为全局角色，可跨租户发布与统计。
- **提交**：保存片段和状态变更在同一个 RPC 事务里完成，提交后页面变为只读。

## 数据表

| 表 | 说明 |
| --- | --- |
| `tenants` | 租户 |
| `profiles` | 账号资料，关联 `auth.users`，含角色与租户 |
| `tasks` | 任务、视频 URL、租户、领取人、状态、提交时间 |
| `segments` | 时间段（毫秒）及备注，同一任务不允许重叠 |
| `task_workloads`（视图） | 已提交任务的工时明细，管理员统计用 |

## 视频来源

任务里直接保存 Hugging Face 上的公开视频链接，不占用 Supabase 存储：

- Push-T 推方块（约 7 MB，加载快）
- ALOHA 双臂做咖啡（约 500 MB，首次加载较慢）

## 常用命令

```bash
npm run dev     # 开发
npm run build   # 构建
npm run lint    # ESLint
npm run seed    # 写入演示数据（需要 service_role key）
```
