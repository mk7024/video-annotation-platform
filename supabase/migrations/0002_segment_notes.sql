-- 片段备注：为 segments 增加 note 列并更新保存 RPC
-- 已执行过旧版 0001 的项目运行本文件即可；全新项目按文件名顺序执行所有迁移。

alter table public.segments
  add column if not exists note text;

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
