'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { translateDbError } from '@/lib/errors'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/types'

export type CreateTenantState = { error?: string; success?: string }
export type CreateAnnotatorState = { error?: string; success?: string }

const EMAIL_REGEX = /^\S+@\S+\.\S+$/

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData
): Promise<CreateTenantState> {
  await requireProfile('admin')

  const name = String(formData.get('name') ?? '').trim()
  if (!name) {
    return { error: '租户名称不能为空' }
  }
  if (name.length > 50) {
    return { error: '租户名称不能超过 50 字' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('tenants').insert({ name })

  if (error) {
    return {
      error: error.message.includes('row-level security')
        ? '没有创建权限，请确认当前账号是管理员（并已执行 0005 迁移）'
        : '创建失败，请稍后重试',
    }
  }

  revalidatePath('/admin/members')
  revalidatePath('/admin')
  return { success: `已创建租户「${name}」，发布任务时即可选择。` }
}

export async function createAnnotatorAction(
  _prev: CreateAnnotatorState,
  formData: FormData
): Promise<CreateAnnotatorState> {
  await requireProfile('admin')

  const service = createServiceClient()
  if (!service) {
    return {
      error:
        '创建账号需要服务端配置 SUPABASE_SERVICE_ROLE_KEY（.env.local），未配置时可先用 seed 脚本或 Supabase Dashboard 建号。',
    }
  }

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const displayName = String(formData.get('displayName') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const tenantId = String(formData.get('tenantId') ?? '').trim()

  if (!EMAIL_REGEX.test(email)) {
    return { error: '邮箱格式不正确' }
  }
  if (!displayName) {
    return { error: '姓名不能为空' }
  }
  if (password.length < 6 || password.length > 72) {
    return { error: '初始密码长度需在 6 ~ 72 位之间' }
  }
  if (!tenantId) {
    return { error: '请选择所属租户' }
  }

  const supabase = await createClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('id', tenantId)
    .maybeSingle()
  if (!tenant) {
    return { error: '所选租户不存在' }
  }

  // 已有 auth 账号时补建资料（例如在 Dashboard 手工建过），完全重复则报错
  const { data: list } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  const existingUser = (list?.users ?? []).find(
    (user) => user.email?.toLowerCase() === email
  )

  let userId: string
  if (existingUser) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', existingUser.id)
      .maybeSingle()
    if (profile) {
      return { error: '该邮箱已是平台成员' }
    }
    userId = existingUser.id
  } else {
    const { data: created, error: createError } =
      await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      })
    if (createError || !created.user) {
      return {
        error: createError?.message ?? '创建账号失败，请稍后重试',
      }
    }
    userId = created.user.id
  }

  const { error: profileError } = await service.from('profiles').insert({
    id: userId,
    tenant_id: tenantId,
    role: 'annotator',
    display_name: displayName,
  })
  if (profileError) {
    return {
      error: `账号已创建但资料写入失败（${profileError.message}），请重试或手动补建资料。`,
    }
  }

  revalidatePath('/admin/members')
  return {
    success: `已创建标注员「${displayName}」（${email}），所属租户：${tenant.name}。`,
  }
}

export async function moveMemberTenantAction(
  profileId: string,
  tenantId: string
): Promise<ActionResult> {
  await requireProfile('admin')

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_profile_tenant', {
    p_profile_id: profileId,
    p_tenant_id: tenantId,
  })

  if (error) {
    // 兼容尚未执行 0005 迁移的环境
    if (error.code === 'PGRST202') {
      return { ok: false, error: '请先在数据库执行 0005_tenant_admin.sql 迁移' }
    }
    return { ok: false, error: translateDbError(error.message) }
  }

  revalidatePath('/admin/members')
  return { ok: true }
}
