-- 运营闭环：管理员在应用内新建租户、新建标注员账号、调整成员租户、直接指派任务
-- 1. tenants 允许管理员 INSERT（RLS 策略兜底）
-- 2. update_profile_tenant：管理员把标注员移动到其他租户（仅改 tenant_id，不动角色）
-- 3. assign_task：管理员把待领取任务直接指派给同租户标注员（与 claim_task 同样的原子抢占）
-- 注：创建 auth 账号无法用 SQL 完成，由应用内 Server Action 调 Supabase Admin API（需 service_role key）

grant insert on public.tenants to authenticated;

drop policy if exists tenants_admin_insert on public.tenants;
create policy tenants_admin_insert on public.tenants
  for insert to authenticated
  with check (public.is_admin());

create or replace function public.update_profile_tenant(
  p_profile_id uuid,
  p_tenant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  -- 只移动标注员；管理员账号不挂租户，避免误操作
  update public.profiles
     set tenant_id = p_tenant_id
   where id = p_profile_id
     and role = 'annotator';

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.update_profile_tenant(uuid, uuid) from public, anon;
grant execute on function public.update_profile_tenant(uuid, uuid) to authenticated;

create or replace function public.assign_task(
  p_task_id uuid,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_profile public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  select * into v_profile from public.profiles where id = p_profile_id;
  if not found or v_profile.role <> 'annotator' or v_profile.tenant_id is null then
    raise exception 'NOT_ANNOTATOR';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  if v_task.tenant_id <> v_profile.tenant_id then
    raise exception 'TASK_TENANT_MISMATCH';
  end if;

  -- 与 claim_task 相同的原子抢占：并发指派/领取时只有第一个生效
  update public.tasks
     set status = 'claimed', assignee_id = p_profile_id
   where id = p_task_id
     and status = 'unassigned';

  if not found then
    raise exception 'TASK_UNAVAILABLE';
  end if;
end;
$$;

revoke all on function public.assign_task(uuid, uuid) from public, anon;
grant execute on function public.assign_task(uuid, uuid) to authenticated;
