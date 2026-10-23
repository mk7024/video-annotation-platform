import { AppHeader } from '@/components/app-header'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireProfile } from '@/lib/auth'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CreateAnnotatorForm, CreateTenantForm } from './member-forms'
import { MemberTenantSelect } from './member-tenant-select'

type TenantRow = { id: string; name: string }

type ProfileRow = {
  id: string
  display_name: string
  role: 'admin' | 'annotator'
  tenant_id: string | null
  tenant: unknown
}

export default async function MembersPage() {
  const profile = await requireProfile('admin')
  const supabase = await createClient()
  const service = createServiceClient()

  const [{ data: tenantData }, { data: profileData }] = await Promise.all([
    supabase.from('tenants').select('id, name').order('name'),
    supabase
      .from('profiles')
      .select('id, display_name, role, tenant_id, tenant:tenants(name)')
      .order('created_at', { ascending: true }),
  ])

  // 邮箱在 auth.users 里，只有拿到 service_role 才能读出来展示
  const emailById = new Map<string, string>()
  if (service) {
    const { data: list } = await service.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    for (const user of list?.users ?? []) {
      emailById.set(user.id, user.email ?? '')
    }
  }

  const tenants = (tenantData ?? []) as TenantRow[]
  const profiles = (profileData ?? []) as ProfileRow[]
  const membersByTenant = new Map<string, number>()
  for (const item of profiles) {
    if (item.tenant_id) {
      membersByTenant.set(item.tenant_id, (membersByTenant.get(item.tenant_id) ?? 0) + 1)
    }
  }

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">租户与成员</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            新团队入驻、新标注员入职都在这里完成，不再需要手工跑脚本或开数据库控制台。
          </p>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>创建租户</CardTitle>
              <CardDescription>创建后立即出现在发布任务的租户选项里。</CardDescription>
            </CardHeader>
            <CardContent>
              <CreateTenantForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>创建标注员账号</CardTitle>
              <CardDescription>
                通过 Supabase Admin API 创建登录账号并写入资料（需要服务端配置 service_role key）。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateAnnotatorForm tenants={tenants} canCreateUsers={service !== null} />
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid items-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>租户（{tenants.length}）</CardTitle>
              <CardDescription>按成员数排序。</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>租户</TableHead>
                    <TableHead className="text-right">成员数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...tenants]
                    .sort(
                      (a, b) =>
                        (membersByTenant.get(b.id) ?? 0) -
                        (membersByTenant.get(a.id) ?? 0)
                    )
                    .map((tenant) => (
                      <TableRow key={tenant.id}>
                        <TableCell className="font-medium">{tenant.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {membersByTenant.get(tenant.id) ?? 0}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>成员（{profiles.length}）</CardTitle>
              <CardDescription>
                标注员可调整所属租户；管理员为全局账号，不挂租户。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead className="hidden md:table-cell">邮箱</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>所属租户</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((item) => (
                    <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.display_name}
                          {item.id === profile.id ? (
                            <span className="ml-1 text-xs text-muted-foreground">（我）</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {emailById.get(item.id) ?? '—'}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              item.role === 'admin'
                                ? 'bg-primary/10 text-primary'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {item.role === 'admin' ? '管理员' : '标注员'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {item.role === 'annotator' ? (
                            <MemberTenantSelect
                              profileId={item.id}
                              currentTenantId={item.tenant_id}
                              tenants={tenants}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">全局</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  }
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
