import { Clapperboard } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LoginForm } from './login-form'

const DEMO_ACCOUNTS = [
  { email: 'admin@demo.com', name: '管理员', scope: '全局，可跨租户' },
  { email: 'alice@demo.com', name: '林晓 · 标注员', scope: '星海机器人，已有提交记录' },
  { email: 'bob@demo.com', name: '陈默 · 标注员', scope: '星海机器人，已有草稿任务' },
  { email: 'carol@demo.com', name: '周宁 · 标注员', scope: '远山数据' },
]

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Clapperboard className="size-5" />
          </div>
          <h1 className="text-xl font-semibold">视频片段标注平台</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            机器人示教视频标注与有效工时统计
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>登录</CardTitle>
            <CardDescription>使用管理员或标注员账号进入</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>演示账号</CardTitle>
            <CardDescription>统一密码：demo123456</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {DEMO_ACCOUNTS.map((account) => (
              <div
                key={account.email}
                className="flex items-start justify-between gap-3"
              >
                <span className="font-mono text-xs">{account.email}</span>
                <span className="text-right text-xs text-muted-foreground">
                  {account.name} · {account.scope}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
