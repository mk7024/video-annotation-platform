-- 打回重标附带原因：管理员打回时必须写明哪里有问题，标注员在任务页看到，重新提交后自动清除
-- 1. tasks 新增 reopen_note（当前生效的打回备注，仅最近一次）
-- 2. reopen_task 增加 p_note 参数（更换签名，先 drop 旧函数避免重载歧义）
-- 3. submit_task 提交成功时清空 reopen_note

alter table public.tasks
  add column if not exists reopen_note text;

drop function if exists public.reopen_task(uuid);

create or replace function public.reopen_task(p_task_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  if p_note is null or length(btrim(p_note)) = 0 then
    raise exception 'REOPEN_NOTE_REQUIRED';
  end if;

  if length(p_note) > 1000 then
    raise exception 'INVALID_NOTE';
  end if;

  update public.tasks
     set status = 'claimed',
         submitted_at = null,
         reopen_note = btrim(p_note)
   where id = p_task_id
     and status = 'submitted';

  if not found then
    raise exception 'TASK_NOT_SUBMITTED';
  end if;
end;
$$;

revoke all on function public.reopen_task(uuid, text) from public, anon;
grant execute on function public.reopen_task(uuid, text) to authenticated;

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
     set status = 'submitted',
         submitted_at = now(),
         reopen_note = null
   where id = p_task_id
     and status = 'claimed'
     and assignee_id = auth.uid();
end;
$$;

revoke all on function public.submit_task(uuid, jsonb) from public, anon;
grant execute on function public.submit_task(uuid, jsonb) to authenticated;
