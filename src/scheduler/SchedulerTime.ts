import type { SchedulerSchedule } from './SchedulerTypes';

export function calculateNextRun(schedule: SchedulerSchedule, after: number = Date.now()): number {
  if (schedule.type === 'once') return schedule.at;
  if (schedule.type === 'daily') {
    const next = new Date(after);
    next.setHours(schedule.hour, schedule.minute, 0, 0);
    if (next.getTime() <= after) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  const weekdays = new Set(schedule.weekdays);
  for (let offset = 0; offset <= 7; offset += 1) {
    const next = new Date(after);
    next.setDate(next.getDate() + offset);
    next.setHours(schedule.hour, schedule.minute, 0, 0);
    if (next.getTime() > after && weekdays.has(next.getDay())) return next.getTime();
  }
  throw new Error('无法计算每周任务的下次执行时间。');
}

export function scheduleToCron(schedule: Exclude<SchedulerSchedule, { type: 'once' }>): string {
  if (schedule.type === 'daily') return `0 ${schedule.minute} ${schedule.hour} * * *`;
  return `0 ${schedule.minute} ${schedule.hour} * * ${[...new Set(schedule.weekdays)].sort().join(',')}`;
}

export function formatSchedule(schedule: SchedulerSchedule): string {
  if (schedule.type === 'once') return new Date(schedule.at).toLocaleString('zh-CN', { hour12: false });
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;
  if (schedule.type === 'daily') return `每天 ${time}`;
  const labels = ['日', '一', '二', '三', '四', '五', '六'];
  return `每周${schedule.weekdays.map((day) => labels[day]).join('、')} ${time}`;
}

export function validateSchedule(schedule: SchedulerSchedule): void {
  if (schedule.type === 'once') {
    if (!Number.isFinite(schedule.at)) throw new Error('一次性任务时间无效。');
    return;
  }
  if (!Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23) {
    throw new Error('小时必须在 0 到 23 之间。');
  }
  if (!Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) {
    throw new Error('分钟必须在 0 到 59 之间。');
  }
  if (
    schedule.type === 'weekly' &&
    (schedule.weekdays.length === 0 || schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
  ) {
    throw new Error('每周任务必须包含有效星期。');
  }
}
