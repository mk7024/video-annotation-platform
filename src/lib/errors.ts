const MESSAGES: Record<string, string> = {
  TASK_UNAVAILABLE: '任务已被其他人领取或不存在',
  TASK_NOT_EDITABLE: '任务状态已变化，无法继续编辑',
  TASK_NOT_SUBMITTED: '只有已提交的任务才能打回重标',
  REOPEN_NOTE_REQUIRED: '请填写打回原因，标注员需要知道哪里有问题',
  INVALID_NOTE: '备注不能超过 1000 字',
  TASK_NOT_FOUND: '任务不存在',
  TASK_TENANT_MISMATCH: '标注员与任务不属于同一租户',
  TENANT_NOT_FOUND: '租户不存在',
  INVALID_SEGMENTS: '时间段数据不合法（长度至少 0.1 秒，终点须晚于起点）',
  SEGMENTS_OVERLAP: '时间段之间不能重叠',
  SEGMENTS_BEYOND_VIDEO: '时间段终点超出视频总时长',
  INVALID_DURATION: '视频时长数据不合法',
  NOT_ALLOWED: '没有权限执行该操作',
  EMPTY_SEGMENTS: '请至少添加一个时间段后再提交',
  NOT_ANNOTATOR: '当前账号不是标注员',
  NOT_ADMIN: '当前账号不是管理员',
  PROFILE_NOT_FOUND: '账号资料不存在，请重新登录',
  segments_no_overlap: '时间段之间不能重叠',
  exclusion_constraint: '时间段之间不能重叠',
}

export function translateDbError(message: string): string {
  const key = Object.keys(MESSAGES).find((code) => message.includes(code))
  return key ? MESSAGES[key] : '操作失败，请稍后重试'
}
