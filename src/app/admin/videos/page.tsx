import Link from 'next/link'
import { ExternalLink, GitCompareArrows } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
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
import { formatDuration } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import type { TaskStatus, VideoRecord } from '@/lib/types'
import { AddVideoForm } from './add-video-form'
import { VideoDeleteButton } from './video-delete-button'

type TaskRefRow = { id: string; video_id: string; status: TaskStatus }

export default async function VideosPage() {
  const profile = await requireProfile('admin')
  const supabase = await createClient()

  const [{ data: videoData, error: videoError }, { data: taskRefData }] =
    await Promise.all([
      supabase
        .from('videos')
        .select('id, title, url, duration_ms, dataset, episode, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('tasks').select('id, video_id, status'),
    ])

  if (videoError) {
    throw new Error(videoError.message)
  }

  const videos = (videoData ?? []) as Array<VideoRecord & { created_at: string }>
  const taskRefs = (taskRefData ?? []) as TaskRefRow[]

  const statsByVideo = new Map<string, { tasks: number; submitted: number }>()
  for (const ref of taskRefs) {
    const current = statsByVideo.get(ref.video_id) ?? { tasks: 0, submitted: 0 }
    current.tasks += 1
    if (ref.status === 'submitted') {
      current.submitted += 1
    }
    statsByVideo.set(ref.video_id, current)
  }

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">视频库</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            视频是任务的一等实体：发布任务从这里选择，任务与统计都支持按视频筛选；同一视频发布多个任务即可做标注一致性比对。
          </p>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>添加视频</CardTitle>
              <CardDescription>
                支持 Hugging Face 等可直链访问的 MP4，可一键填入两个示例数据集视频。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AddVideoForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>全部视频</CardTitle>
              <CardDescription>
                共 {videos.length} 个视频；时长由标注员首次打开任务时自动回填。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {videos.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  视频库还是空的，先在左侧添加一个。
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>视频</TableHead>
                      <TableHead>数据集 / Episode</TableHead>
                      <TableHead>时长</TableHead>
                      <TableHead>任务数</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {videos.map((video) => {
                      const stats = statsByVideo.get(video.id) ?? {
                        tasks: 0,
                        submitted: 0,
                      }
                      return (
                        <TableRow key={video.id}>
                          <TableCell className="max-w-[18rem]">
                            <p className="truncate font-medium">{video.title}</p>
                            <a
                              href={video.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                            >
                              原始链接
                              <ExternalLink className="size-3" />
                            </a>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {video.dataset ? (
                              <span className="font-mono text-xs">
                                {video.dataset}
                                {video.episode ? ` · ${video.episode}` : ''}
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {video.duration_ms
                              ? formatDuration(video.duration_ms)
                              : '待回填'}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {stats.tasks}
                            <span className="text-xs text-muted-foreground">
                              {' '}
                              （已提交 {stats.submitted}）
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              {stats.submitted >= 2 ? (
                                <Link
                                  href={`/admin/compare?video=${video.id}`}
                                  className={buttonVariants({
                                    variant: 'outline',
                                    size: 'sm',
                                  })}
                                >
                                  <GitCompareArrows data-icon="inline-start" />
                                  比对
                                </Link>
                              ) : null}
                              <VideoDeleteButton videoId={video.id} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
