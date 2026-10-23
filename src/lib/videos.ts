const MAX_LABELS = 20
const MAX_LABEL_LENGTH = 30

// 从视频 URL 推导可读标题：Hugging Face 数据集链接带出 "owner/dataset · 文件名"，其余用文件名
export function deriveVideoTitle(url: string): string {
  try {
    const parsed = new URL(url)
    const fileName = parsed.pathname.split('/').filter(Boolean).pop() ?? ''
    const stem = fileName.replace(/\.[^.]+$/, '') || parsed.hostname
    const datasetMatch = parsed.pathname.match(/datasets\/([^/]+\/[^/]+)/)
    if (datasetMatch) {
      return `${datasetMatch[1]} · ${stem}`
    }
    return stem
  } catch {
    return url
  }
}

// 解析管理员填写的快捷标签：中英文逗号/顿号分隔，去重、限数量与长度
export function parseLabelInput(
  raw: string
): { labels: string[] } | { error: string } {
  const labels = [
    ...new Set(
      raw
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ]

  if (labels.length > MAX_LABELS) {
    return { error: `快捷标签最多 ${MAX_LABELS} 个` }
  }
  if (labels.some((label) => label.length > MAX_LABEL_LENGTH)) {
    return { error: `单个快捷标签不能超过 ${MAX_LABEL_LENGTH} 个字` }
  }

  return { labels }
}
