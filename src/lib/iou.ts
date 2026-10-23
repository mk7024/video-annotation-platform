export type Interval = { start: number; end: number }

// 两组内部各自不重叠的区间集合的总交集时长（毫秒），双指针线性扫描
export function intervalsIntersectionMs(a: Interval[], b: Interval[]): number {
  let total = 0
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start)
    const end = Math.min(a[i].end, b[j].end)
    if (end > start) {
      total += end - start
    }
    if (a[i].end < b[j].end) {
      i += 1
    } else {
      j += 1
    }
  }
  return total
}

export function totalMs(intervals: Interval[]): number {
  return intervals.reduce((sum, item) => sum + (item.end - item.start), 0)
}

// 时间 IoU = |A∩B| / |A∪B|，用于双人标注一致性；双方都没标任何片段时无意义，返回 null
export function temporalIou(
  a: Interval[],
  b: Interval[]
): { iou: number; intersectionMs: number; unionMs: number } | null {
  const totalA = totalMs(a)
  const totalB = totalMs(b)
  if (totalA + totalB === 0) {
    return null
  }
  const intersectionMs = intervalsIntersectionMs(a, b)
  const unionMs = totalA + totalB - intersectionMs
  return { iou: unionMs > 0 ? intersectionMs / unionMs : 0, intersectionMs, unionMs }
}
