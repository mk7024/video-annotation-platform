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

3. 复制 **service_role key**（Legacy API keys 里），仅供 seed 脚本与「租户与成员」页创建账号使用，不要加 `NEXT_PUBLIC_` 前缀：

```env
SUPABASE_SERVICE_ROLE_KEY=...
```

4. 打开 Supabase Dashboard → SQL Editor，按文件名顺序执行 [`supabase/migrations`](supabase/migrations) 下的 SQL（已有旧库只需补跑 [0002_segment_notes.sql](supabase/migrations/0002_segment_notes.sql)、[0003_workflow_enhancements.sql](supabase/migrations/0003_workflow_enhancements.sql)、[0004_video_library.sql](supabase/migrations/0004_video_library.sql)、[0005_tenant_admin.sql](supabase/migrations/0005_tenant_admin.sql) 与 [0006_reopen_note.sql](supabase/migrations/0006_reopen_note.sql)；0004 会自动把旧的 `video_url` 回填进视频库）。

### 2. 写入演示数据

```bash
npm run seed
```

重复执行会**重置** 7 个演示任务及其片段。

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

seed 预置了待领取、标注中（草稿）和已提交任务，其中 Push-T 视频预置了 alice / carol 两份独立提交，可在视频库点击「比对」查看时间 IoU。

## 演示路径

1. 用 `admin@demo.com` 登录，先在「视频库」页确认两个示例视频（可一键添加），在「租户与成员」页可以新建租户、创建标注员账号、调整成员所属租户；再到任务管理页发布新任务：从视频库选择视频、填写标注指引与快捷标签，选择租户发布。
2. 用 `bob@demo.com` 登录，领取任务或继续已有的草稿任务，工作台顶部常驻标注指引；在视频上打点（草稿自动保存）、提交。管理员也可以在任务详情页把待领取任务直接指派给指定标注员。
3. 回到管理员账号，在「工作量统计」查看按天汇总的有效时长，支持按租户 / 视频 / 日期筛选，可一键导出对账单与训练数据集；点击任务名可查看时间段列表和备注。
4. 在「视频库」页找到 Push-T 视频，点击「比对」，选择 alice 与 carol 的两份提交，查看时间 IoU、时间轴叠加与分歧片段。
5. 用 `carol@demo.com` 登录，任务列表只会出现「远山数据」的任务，验证租户隔离。

## 规则与工程细节落地

- **时间段不重叠**：前端实时校验（含边界微调校验）+ Server Action 校验 + `save_task_segments` RPC 校验 + Postgres 排他约束 `segments_no_overlap` 四层保障。
- **有效时长与防刷校验**：只汇总 `submitted` 任务的片段，`sum(end_ms - start_ms)`；草稿不计入；服务端同时校验片段终点不超过视频实际时长上限。
- **归日与双端对账**：按 `submitted_at` 换算成 `Asia/Shanghai` 时区后的日期统计；标注员端与管理员端共享同一工时口径，支持实时对账。
- **任务生命周期闭环**：
  - `claim_task` RPC 单条原子 `UPDATE ... WHERE status = 'unassigned'` 防并发抢单；
  - `unclaim_task` 支持标注员释放无法完成的任务（或管理员强制回收超时任务）回任务池；
  - `reopen_task` 支持管理员质检时将不合格的 `submitted` 任务打回 `claimed` 重标，**必须填写打回原因**（写清哪几段有问题），标注员任务页顶部会常驻展示，重新提交后自动清除。
- **视频库（一等实体）**：`videos` 表统一管理视频（标题/链接/时长/数据集元信息），任务通过 `video_id` 引用；发布任务从视频库选择或贴 URL 顺手入库；管理端任务列表、工作量统计与标注员任务列表均支持按视频筛选；视频时长由标注员首次打开任务时自动回填，作为服务端校验的权威值。
- **任务级标注指引与快捷标签**：发布任务时填写「什么算有用片段」的指引与动作标签集；指引常驻展示在工作台顶部（领取前也可见），快捷标签按任务渲染，让两个标注员对同一任务的理解可对齐——这是一致性比对的前提。
- **标注一致性比对（双盲轻量落地）**：对同一视频发布多个任务、两人独立完成后，管理员在「比对」视图查看时间 IoU（|重叠| / |并集|）、双色时间轴叠加与零重叠分歧片段，支撑抽查式质检；同租户片段互相不可见，保证盲态。完整双标（assignment 模型 + 仲裁）的设计取舍见 `report.md`。
- **租户与成员运营闭环**：「租户与成员」页支持新建租户（RLS 策略校验管理员）、创建标注员账号（Server Action 调 Supabase Admin API，需服务端 service_role key，未配置时优雅降级为只读提示）、调整标注员所属租户（`update_profile_tenant` RPC，仅动 tenant_id 不动角色）；任务详情页支持把待领取任务直接指派给同租户标注员（`assign_task` RPC，与抢单同样的原子抢占）。
- **租户隔离与同组防抄袭**：RLS 通过 `auth.uid()` 反查 `profiles.tenant_id` 隔离跨租户任务；同租户内仅任务领取人本人和管理员可读取对应任务的 `segments` 明细。
- **高效标注工作台**：支持键盘快捷键（`Space` 播放/暂停、`I/[` 设起点、`O/]` 设终点、`←/→` 0.1s 步进）、倍速切换（`0.5x ~ 2x`）、区间预览（播到片段终点自动暂停）、已有片段起止边界微调、动作快捷标签、草稿自动保存（修改停止 3 秒后触发）与未保存离开拦截。
- **数据交付与批量下发**：管理员支持单条或按行批量发布任务（链接自动入库去重），支持一键导出每日有效工时 CSV、任务明细 CSV 与标准标注数据集 JSON。

## 数据表

| 表 | 说明 |
| --- | --- |
| `tenants` | 租户 |
| `profiles` | 账号资料，关联 `auth.users`，含角色与租户 |
| `videos` | 视频库：标题、链接、时长、数据集 / Episode 元信息 |
| `tasks` | 任务：引用 `videos`、租户、领取人、状态、提交时间、标注指引与快捷标签 |
| `segments` | 时间段（毫秒）及备注，同一任务不允许重叠 |
| `task_workloads`（视图） | 已提交任务的工时明细（含视频维度），管理员统计用 |

## 视频来源

视频统一在视频库管理，可以直接添加可直链访问的 MP4（不占用 Supabase 存储），seed 预置了两个 Hugging Face 公开数据集视频：

- Push-T 推方块（约 7 MB，加载快）
- ALOHA 双臂做咖啡（约 500 MB，首次加载较慢）

## 常用命令

```bash
npm run dev     # 开发
npm run build   # 构建
npm run lint    # ESLint
npm run seed    # 写入演示数据（需要 service_role key）
```
