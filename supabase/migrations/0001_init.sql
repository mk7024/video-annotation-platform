-- 视频片段标注平台：schema、RLS、RPC、工时视图
create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid references public.tenants (id),
  role text not null check (role in ('admin', 'annotator')),
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint annotator_requires_tenant check (role = 'admin' or tenant_id is not null)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  title text not null,
  video_url text not null,
  status text not null default 'unassigned'
    check (status in ('unassigned', 'claimed', 'submitted')),
  assignee_id uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  constraint task_status_shape check (
    (status = 'unassigned' and assignee_id is null and submitted_at is null)
    or (status = 'claimed' and assignee_id is not null and submitted_at is null)
    or (status = 'submitted' and assignee_id is not null and submitted_at is not null)
  )
);

create table if not exists public.segments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  note text,
  created_at timestamptz not null default now(),
  constraint segments_no_overlap exclude using gist (
    task_id with =,
    int4range(start_ms, end_ms, '[)') with &&
  )
);

create index if not exists tasks_tenant_status_idx on public.tasks (tenant_id, status);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists segments_task_idx on public.segments (task_id);

-- 权限：读走 RLS，写只允许管理员插入任务，其余写操作走 RPC
revoke all on public.tenants, public.profiles, public.tasks, public.segments from anon, authenticated;
grant select on public.tenants, public.profiles, public.tasks, public.segments to authenticated;
grant insert on public.tasks to authenticated;

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.segments enable row level security;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_admin() to authenticated;

drop policy if exists tenants_read on public.tenants;
create policy tenants_read on public.tenants
  for select to authenticated
  using (public.is_admin() or id = public.current_tenant_id());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or tenant_id = public.current_tenant_id()
  );

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks
  for select to authenticated
  using (public.is_admin() or tenant_id = public.current_tenant_id());

drop policy if exists tasks_admin_insert on public.tasks;
create policy tasks_admin_insert on public.tasks
  for insert to authenticated
  with check (public.is_admin() and created_by = auth.uid());

drop policy if exists segments_read on public.segments;
create policy segments_read on public.segments
  for select to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = segments.task_id
        and (public.is_admin() or t.tenant_id = public.current_tenant_id())
    )
  );

-- 标注员领取任务：并发下只有第一个 update 成功
create or replace function public.claim_task(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_task public.tasks%rowtype;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if v_profile.role <> 'annotator' or v_profile.tenant_id is null then
    raise exception 'NOT_ANNOTATOR';
  end if;

  update public.tasks
     set status = 'claimed', assignee_id = auth.uid()
   where id = p_task_id
     and tenant_id = v_profile.tenant_id
     and status = 'unassigned'
  returning * into v_task;

  if not found then
    raise exception 'TASK_UNAVAILABLE';
  end if;

  return v_task;
end;
$$;

revoke all on function public.claim_task(uuid) from public, anon;
grant execute on function public.claim_task(uuid) to authenticated;

-- 保存草稿：整批替换，服务端校验格式与重叠
create or replace function public.save_task_segments(p_task_id uuid, p_segments jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
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

-- 提交：保存片段并把任务标记为 submitted，工时归入提交当天
create or replace function public.submit_task(p_task_id uuid, p_segments jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
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

  v_count := public.save_task_segments(p_task_id, p_segments);
  if v_count = 0 then
    raise exception 'EMPTY_SEGMENTS';
  end if;

  update public.tasks
     set status = 'submitted', submitted_at = now()
   where id = p_task_id
     and status = 'claimed'
     and assignee_id = auth.uid();
end;
$$;

revoke all on function public.submit_task(uuid, jsonb) from public, anon;
grant execute on function public.submit_task(uuid, jsonb) to authenticated;

-- 已提交任务的工时明细；security_invoker 让底层 RLS 继续生效
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
  coalesce(sum(s.end_ms - s.start_ms), 0)::bigint as effective_ms
from public.tasks t
join public.tenants tn on tn.id = t.tenant_id
left join public.profiles p on p.id = t.assignee_id
left join public.segments s on s.task_id = t.id
where t.status = 'submitted'
group by t.id, tn.name, p.display_name;

grant select on public.task_workloads to authenticated;
