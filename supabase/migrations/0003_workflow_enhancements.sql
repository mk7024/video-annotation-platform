-- 任务流转与同租户片段隐私增强：
-- 1. 收紧 segments_read：同租户标注员仅可读取自己领取/提交任务的片段，避免互相查看答案
-- 2. 新增 unclaim_task：标注员本人或管理员释放“标注中”的任务回待领取池
-- 3. 新增 reopen_task：管理员将有问题的“已提交”任务打回“标注中”重标

drop policy if exists segments_read on public.segments;
create policy segments_read on public.segments
  for select to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = segments.task_id
        and (
          public.is_admin()
          or (t.tenant_id = public.current_tenant_id() and t.assignee_id = auth.uid())
        )
    )
  );

create or replace function public.unclaim_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.tasks
    where id = p_task_id
      and status = 'claimed'
      and (
        v_profile.role = 'admin'
        or (assignee_id = auth.uid() and tenant_id = v_profile.tenant_id)
      )
  ) then
    raise exception 'TASK_NOT_EDITABLE';
  end if;

  delete from public.segments where task_id = p_task_id;

  update public.tasks
     set status = 'unassigned', assignee_id = null, submitted_at = null
   where id = p_task_id
     and status = 'claimed';
end;
$$;

revoke all on function public.unclaim_task(uuid) from public, anon;
grant execute on function public.unclaim_task(uuid) to authenticated;

create or replace function public.reopen_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  update public.tasks
     set status = 'claimed', submitted_at = null
   where id = p_task_id
     and status = 'submitted';

  if not found then
    raise exception 'TASK_NOT_SUBMITTED';
  end if;
end;
$$;

revoke all on function public.reopen_task(uuid) from public, anon;
grant execute on function public.reopen_task(uuid) to authenticated;
