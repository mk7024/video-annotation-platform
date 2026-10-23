'use client'

import { useActionState } from 'react'
import { Building2, UserPlus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createAnnotatorAction,
  createTenantAction,
  type CreateAnnotatorState,
  type CreateTenantState,
} from './actions'

type TenantOption = { id: string; name: string }

const initialTenantState: CreateTenantState = {}
const initialAnnotatorState: CreateAnnotatorState = {}

export function CreateTenantForm() {
  const [state, formAction, pending] = useActionState(
    createTenantAction,
    initialTenantState
  )

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="tenantName">租户名称</Label>
        <Input
          id="tenantName"
          name="name"
          placeholder="例如：新月具身"
          required
          maxLength={50}
        />
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.success ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {state.success}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        <Building2 data-icon="inline-start" />
        {pending ? '创建中…' : '创建租户'}
      </Button>
    </form>
  )
}

export function CreateAnnotatorForm({
  tenants,
  canCreateUsers,
}: {
  tenants: TenantOption[]
  canCreateUsers: boolean
}) {
  const [state, formAction, pending] = useActionState(
    createAnnotatorAction,
    initialAnnotatorState
  )

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {!canCreateUsers ? (
        <Alert>
          <AlertDescription>
            未检测到 SUPABASE_SERVICE_ROLE_KEY：创建登录账号需要该密钥（服务端环境变量）。
            配置后重启即可在此创建账号，当前可先在 Supabase Dashboard 手工建号。
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="annotatorEmail">邮箱（登录账号）</Label>
        <Input
          id="annotatorEmail"
          name="email"
          type="email"
          placeholder="annotator@team.com"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="annotatorName">姓名</Label>
        <Input
          id="annotatorName"
          name="displayName"
          placeholder="例如：王小明"
          required
          maxLength={50}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="annotatorPassword">初始密码</Label>
        <Input
          id="annotatorPassword"
          name="password"
          type="text"
          placeholder="至少 6 位，通知标注员首次登录后修改"
          required
          minLength={6}
          maxLength={72}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="annotatorTenant">所属租户</Label>
        <select
          id="annotatorTenant"
          name="tenantId"
          required
          defaultValue={tenants[0]?.id ?? ''}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.success ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {state.success}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || !canCreateUsers || tenants.length === 0}>
        <UserPlus data-icon="inline-start" />
        {pending ? '创建中…' : '创建标注员账号'}
      </Button>
    </form>
  )
}
