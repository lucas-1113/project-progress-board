// 节点提醒逻辑：解析“检查日期”字段并计算预警状态。
// 支持的写法（均忽略前后空格）：
//   带年份：2026.08.12 / 2026/08/12 / 2026-08-12 / 2026年08月12日
//   省略年份：8.11 / 8/11 / 8月11日 / 8月11（默认按当前年份，便于“8/11”这类写法）
// 缺少年份时始终使用当前年份，避免把已过期的检查日期误判到明年。

export type ReminderLevel = "overdue" | "due" | "soon" | null;

export interface CheckDateReminder {
  level: ReminderLevel;
  days: number; // 负数 = 已逾期
  date: Date; // 解析后的检查日期
  raw: string; // 原始文本
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const candidate = new Date(year, month - 1, day);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day
  );
}

export function parseCheckDate(raw: string): Date | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  // 带 4 位年份：2026.08.12 / 2026/08/12 / 2026-08-12 / 2026年08月12日
  const withYear = text.match(/^(\d{4})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\s*日?$/);
  if (withYear) {
    const year = Number(withYear[1]);
    const month = Number(withYear[2]);
    const day = Number(withYear[3]);
    if (isValidYmd(year, month, day)) return new Date(year, month - 1, day);
  }

  // 省略年份：8.11 / 8/11 / 8月11日 / 8月11 → 使用当前年份
  const noYear = text.match(/^(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\s*日?$/);
  if (noYear) {
    const month = Number(noYear[1]);
    const day = Number(noYear[2]);
    const now = new Date();
    if (isValidYmd(now.getFullYear(), month, day)) {
      return new Date(now.getFullYear(), month - 1, day);
    }
  }

  return null;
}

export function daysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// 根据检查日期与预警提前天数，得出提醒级别。无日期或不在预警窗口内返回 null。
export function getReminder(cp: string, warningDays: number): CheckDateReminder | null {
  const parsed = parseCheckDate(cp);
  if (!parsed) return null;
  const days = daysUntil(parsed);
  let level: ReminderLevel = null;
  if (days < 0) level = "overdue";
  else if (days === 0) level = "due";
  else if (days <= warningDays) level = "soon";
  if (!level) return null;
  return { level, days, date: parsed, raw: cp };
}

const FULL_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatCheckDate(date: Date): string {
  return FULL_FORMATTER.format(date);
}

export function reminderLabel(reminder: CheckDateReminder): string {
  if (reminder.level === "overdue") return `已逾期 ${Math.abs(reminder.days)} 天`;
  if (reminder.level === "due") return "今天到期";
  return `剩 ${reminder.days} 天`;
}
