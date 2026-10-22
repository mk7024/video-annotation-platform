const MESSAGES: Record<string, string> = {
  TASK_UNAVAILABLE: '任务已被其他人领取或不存在',
  TASK_NOT_EDITABLE: '任务状态已变化，无法继续编辑',
  INVALID_SEGMENTS: '时间段数据不合法',
  SEGMENTS_OVERLAP: '时间段之间不能重叠',
  EMPTY_SEGMENTS: '请至少添加一个时间段后再提交',
  NOT_ANNOTATOR: '当前账号不是标注员',
  PROFILE_NOT_FOUND: '账号资料不存在，请重新登录',
  segments_no_overlap: '时间段之间不能重叠',
  exclusion_constraint: '时间段之间不能重叠',
}

export function translateDbError(message: string): string {
  const key = Object.keys(MESSAGES).find((code) => message.includes(code))
  return key ? MESSAGES[key] : '操作失败，请稍后重试'
}
