import { createClient } from '@supabase/supabase-js'

for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file)
  } catch {}
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRoleKey) {
  console.error(
    '缺少环境变量：请在 .env.local 中配置 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY（service_role 只能放服务端）。'
  )
  process.exit(1)
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const PASSWORD = 'demo123456'

const TENANTS = [
  { id: '11111111-1111-4111-8111-111111111111', name: '星海机器人' },
  { id: '22222222-2222-4222-8222-222222222222', name: '远山数据' },
]

const USERS = [
  {
    key: 'admin',
    email: 'admin@demo.com',
    displayName: '平台管理员',
    role: 'admin',
    tenantId: null,
  },
  {
    key: 'alice',
    email: 'alice@demo.com',
    displayName: '林晓',
    role: 'annotator',
    tenantId: TENANTS[0].id,
  },
  {
    key: 'bob',
    email: 'bob@demo.com',
    displayName: '陈默',
    role: 'annotator',
    tenantId: TENANTS[0].id,
  },
  {
    key: 'carol',
    email: 'carol@demo.com',
    displayName: '周宁',
    role: 'annotator',
    tenantId: TENANTS[1].id,
  },
]

const VIDEO = {
  aloha:
    'https://huggingface.co/datasets/lerobot/aloha_static_coffee/resolve/main/videos/observation.images.cam_high/chunk-000/file-000.mp4',
  pusht:
    'https://huggingface.co/datasets/lerobot/pusht/resolve/main/videos/observation.image/chunk-000/file-000.mp4',
}

const TASKS = {
  alohaFree: 'aaaaaaaa-0001-4000-8000-000000000001',
  pushtFree: 'aaaaaaaa-0002-4000-8000-000000000002',
  alohaSubmitted: 'aaaaaaaa-0003-4000-8000-000000000003',
  pushtSubmitted: 'aaaaaaaa-0004-4000-8000-000000000004',
  pushtFreeB: 'aaaaaaaa-0005-4000-8000-000000000005',
  alohaDraft: 'aaaaaaaa-0006-4000-8000-000000000006',
}

function fail(label, error) {
  console.error(`\n[seed] ${label}失败：`, error?.message ?? error)
  process.exit(1)
}

function shanghaiIso(dayOffset, hour, minute) {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const base = new Date(`${dateStr}T00:00:00+08:00`)
  return new Date(
    base.getTime() + (dayOffset * 24 + hour) * 3600_000 + minute * 60_000
  ).toISOString()
}

async function getOrCreateUser(email, displayName) {
  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (listError) fail('读取账号列表', listError)

  const existing = list.users.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase()
  )

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
    })
    if (error) fail(`更新账号 ${email}`, error)
    return existing.id
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  })
  if (error) fail(`创建账号 ${email}`, error)
  return data.user.id
}

async function main() {
  const { error: tenantError } = await admin
    .from('tenants')
    .upsert(TENANTS, { onConflict: 'id' })
  if (tenantError) fail('写入租户', tenantError)

  const userIds = {}
  for (const user of USERS) {
    userIds[user.key] = await getOrCreateUser(user.email, user.displayName)
  }

  const { error: profileError } = await admin.from('profiles').upsert(
    USERS.map((user) => ({
      id: userIds[user.key],
      tenant_id: user.tenantId,
      role: user.role,
      display_name: user.displayName,
    })),
    { onConflict: 'id' }
  )
  if (profileError) fail('写入用户资料', profileError)

  const adminId = userIds.admin
  const tasks = [
    {
      id: TASKS.alohaFree,
      tenant_id: TENANTS[0].id,
      title: 'ALOHA 咖啡制作 · 有效片段标注',
      video_url: VIDEO.aloha,
      status: 'unassigned',
      assignee_id: null,
      created_by: adminId,
      submitted_at: null,
    },
    {
      id: TASKS.pushtFree,
      tenant_id: TENANTS[0].id,
      title: 'Push-T 推方块 · 动作切分',
      video_url: VIDEO.pusht,
      status: 'unassigned',
      assignee_id: null,
      created_by: adminId,
      submitted_at: null,
    },
    {
      id: TASKS.alohaSubmitted,
      tenant_id: TENANTS[0].id,
      title: 'ALOHA 咖啡制作 · 示例已提交',
      video_url: VIDEO.aloha,
      status: 'submitted',
      assignee_id: userIds.alice,
      created_by: adminId,
      submitted_at: shanghaiIso(0, 10, 30),
    },
    {
      id: TASKS.pushtSubmitted,
      tenant_id: TENANTS[1].id,
      title: 'Push-T 推方块 · 示例已提交',
      video_url: VIDEO.pusht,
      status: 'submitted',
      assignee_id: userIds.carol,
      created_by: adminId,
      submitted_at: shanghaiIso(-1, 16, 0),
    },
    {
      id: TASKS.pushtFreeB,
      tenant_id: TENANTS[1].id,
      title: 'Push-T 推方块 · 待领取',
      video_url: VIDEO.pusht,
      status: 'unassigned',
      assignee_id: null,
      created_by: adminId,
      submitted_at: null,
    },
    {
      id: TASKS.alohaDraft,
      tenant_id: TENANTS[0].id,
      title: 'ALOHA 咖啡制作 · 草稿示例',
      video_url: VIDEO.aloha,
      status: 'claimed',
      assignee_id: userIds.bob,
      created_by: adminId,
      submitted_at: null,
    },
  ]

  const seedTaskIds = Object.values(TASKS)
  const { error: resetSegmentsError } = await admin
    .from('segments')
    .delete()
    .in('task_id', seedTaskIds)
  if (resetSegmentsError) fail('重置演示片段', resetSegmentsError)

  const { error: taskError } = await admin
    .from('tasks')
    .upsert(tasks, { onConflict: 'id' })
  if (taskError) fail('写入任务', taskError)

  const segmentRows = [
    { task_id: TASKS.alohaSubmitted, start_ms: 10_000, end_ms: 22_500, note: '抓取咖啡杯' },
    { task_id: TASKS.alohaSubmitted, start_ms: 35_000, end_ms: 48_000, note: '移到咖啡机下方' },
    { task_id: TASKS.alohaSubmitted, start_ms: 60_000, end_ms: 70_000, note: '按下萃取按钮' },
    { task_id: TASKS.pushtSubmitted, start_ms: 5_000, end_ms: 15_000, note: '机械臂移向方块' },
    { task_id: TASKS.pushtSubmitted, start_ms: 30_000, end_ms: 42_000, note: '把方块推到目标区' },
    { task_id: TASKS.alohaDraft, start_ms: 15_000, end_ms: 25_000, note: '对准杯口（示例草稿备注）' },
    { task_id: TASKS.alohaDraft, start_ms: 40_000, end_ms: 52_000, note: '等待萃取完成（示例草稿备注）' },
  ]

  const { error: segmentError } = await admin
    .from('segments')
    .insert(segmentRows)
  if (segmentError) fail('写入演示片段', segmentError)

  console.log('\n[seed] 演示数据已就绪（重复执行会重置演示任务）')
  console.log(`\n统一密码：${PASSWORD}`)
  console.log('  管理员：admin@demo.com（全局）')
  console.log('  标注员：alice@demo.com / bob@demo.com（星海机器人）')
  console.log('  标注员：carol@demo.com（远山数据）\n')
}

main().catch((error) => fail('执行 seed', error))
