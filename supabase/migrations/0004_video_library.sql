-- 视频库 + 任务级标注指引与标签 + RPC 校验加强
-- 1. 新增 videos 表：视频成为一等实体（标题/链接/时长/数据集元信息），tasks 改为 video_id 外键
-- 2. tasks 新增 guideline（标注指引）与 labels（快捷标签集），把"标什么"从写死的前端常量变成任务配置
-- 3. 已有任务的 video_url 自动回填进视频库，随后删除该列，保证单一数据源
-- 4. save_task_segments 增加最小片段长度（100ms）与视频时长权威值校验
-- 5. 新增 report_video_duration：工作台首次加载视频后回填时长，供服务端校验
-- 6. task_workloads 视图补充 video_id / video_title，支撑按视频筛选统计

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null unique,
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  dataset text,
  episode text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.tasks
  add column if not exists video_id uuid references public.videos (id),
  add column if not exists guideline text,
  add column if not exists labels jsonb not null default '[]'::jsonb;

-- 回填旧数据：把 tasks.video_url 收进视频库并挂上 video_id（列存在时才执行，保证可重复运行）
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'video_url'
  ) then
    insert into public.videos (title, url, created_by)
    select
      case
        when t.video_url like '%lerobot/pusht%' then 'Push-T 推方块 · file-000'
        when t.video_url like '%aloha_static_coffee%' then 'ALOHA 双臂做咖啡 · file-000'
        else regexp_replace(regexp_replace(t.video_url, '.*/', ''), '\.[^.]+$', '')
      end,
      t.video_url,
      -- Postgres 没有内置 min(uuid) 聚合，先转 text 再转回
      min(t.created_by::text)::uuid
    from public.tasks t
    group by t.video_url
    on conflict (url) do nothing;

    update public.tasks t
       set video_id = v.id
      from public.videos v
     where v.url = t.video_url
       and t.video_id is null;

    alter table public.tasks alter column video_id set not null;
    alter table public.tasks drop column video_url;
  end if;
end $$;

create index if not exists videos_url_idx on public.videos (url);
create index if not exists tasks_video_idx on public.tasks (video_id);

-- 权限：读对所有登录用户开放（视频标题需要出现在标注员任务列表）；写仅管理员（RLS 兜底）
revoke all on public.videos from anon, authenticated;
grant select, insert, update, delete on public.videos to authenticated;

alter table public.videos enable row level security;

drop policy if exists videos_read on public.videos;
create policy videos_read on public.videos
  for select to authenticated
  using (true);

drop policy if exists videos_admin_insert on public.videos;
create policy videos_admin_insert on public.videos
  for insert to authenticated
  with check (public.is_admin() and created_by = auth.uid());

drop policy if exists videos_admin_update on public.videos;
create policy videos_admin_update on public.videos
  for update to authenticated
  using (public.is_admin());

drop policy if exists videos_admin_delete on public.videos;
create policy videos_admin_delete on public.videos
  for delete to authenticated
  using (public.is_admin());

-- 保存草稿：整批替换；新增最小长度校验与视频时长权威值校验
create or replace function public.save_task_segments(p_task_id uuid, p_segments jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_duration_ms integer;
  v_count integer;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.tasks
    where id = p_task_id
      and status = 'claimed'
      and assignee_id = auth.uid()
      and tenant_id = v_profile.tenant_id
  ) then
    raise exception 'TASK_NOT_EDITABLE';
  end if;

  if p_segments is null or jsonb_typeof(p_segments) <> 'array' then
    raise exception 'INVALID_SEGMENTS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_segments) as x(start_ms integer, end_ms integer, note text)
    where start_ms is null
       or end_ms is null
       or start_ms < 0
       or end_ms <= start_ms
       or (end_ms - start_ms) < 100
       or length(coalesce(x.note, '')) > 500
  ) then
    raise exception 'INVALID_SEGMENTS';
  end if;

  if exists (
    select 1
    from (
      select start_ms, end_ms,
             lag(end_ms) over (order by start_ms, end_ms) as prev_end
      from jsonb_to_recordset(p_segments) as x(start_ms integer, end_ms integer)
    ) s
    where prev_end > start_ms
  ) then
    raise exception 'SEGMENTS_OVERLAP';
  end if;

  -- 时长权威值：视频库已回填 duration_ms 时，终点不允许超出（500ms 容差对应播放器 seek 精度）
  select v.duration_ms into v_duration_ms
    from public.tasks t
    join public.videos v on v.id = t.video_id
   where t.id = p_task_id;

  if v_duration_ms is not null and exists (
    select 1
    from jsonb_to_recordset(p_segments) as x(start_ms integer, end_ms integer)
    where x.end_ms > v_duration_ms + 500
  ) then
    raise exception 'SEGMENTS_BEYOND_VIDEO';
  end if;

  delete from public.segments where task_id = p_task_id;

  insert into public.segments (task_id, start_ms, end_ms, note)
  select p_task_id, x.start_ms, x.end_ms, nullif(btrim(coalesce(x.note, '')), '')
  from jsonb_to_recordset(p_segments) as x(start_ms integer, end_ms integer, note text);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.save_task_segments(uuid, jsonb) from public, anon;
grant execute on function public.save_task_segments(uuid, jsonb) to authenticated;

-- 工作台首次加载视频后回填时长：仅允许管理员或该视频任务的标注员，且只填补空值（不覆盖管理员数据）
create or replace function public.report_video_duration(
  p_video_id uuid,
  p_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_duration_ms is null or p_duration_ms <= 0 or p_duration_ms > 12 * 3600 * 1000 then
    raise exception 'INVALID_DURATION';
  end if;

  if not public.is_admin() and not exists (
    select 1 from public.tasks
    where video_id = p_video_id
      and assignee_id = auth.uid()
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.videos
     set duration_ms = p_duration_ms
   where id = p_video_id
     and duration_ms is null;
end;
$$;

revoke all on function public.report_video_duration(uuid, integer) from public, anon;
grant execute on function public.report_video_duration(uuid, integer) to authenticated;

-- 工时明细视图补充视频维度
-- 注意：CREATE OR REPLACE VIEW 只允许在末尾追加列，视频两列必须放在最后，不能插入中间
create or replace view public.task_workloads
with (security_invoker = true) as
select
  t.id as task_id,
  t.tenant_id,
  tn.name as tenant_name,
  t.title,
  t.assignee_id,
  p.display_name as annotator_name,
  t.submitted_at,
  (t.submitted_at at time zone 'Asia/Shanghai')::date as submitted_date,
  coalesce(sum(s.end_ms - s.start_ms), 0)::bigint as effective_ms,
  t.video_id,
  v.title as video_title
from public.tasks t
join public.tenants tn on tn.id = t.tenant_id
join public.videos v on v.id = t.video_id
left join public.profiles p on p.id = t.assignee_id
left join public.segments s on s.task_id = t.id
where t.status = 'submitted'
group by t.id, tn.name, v.title, p.display_name;

grant select on public.task_workloads to authenticated;
