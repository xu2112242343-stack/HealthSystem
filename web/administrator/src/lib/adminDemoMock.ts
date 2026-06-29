/**
 * 管理端演示用模拟数据。
 * 开启方式（任选其一）：
 * - 地址栏：?demo=1 或 ?demo1=1
 * - 环境变量：VITE_ADMIN_DEMO=1 | VITE_DOCTOR_DEMO=1（开发环境见 .env.development）
 */

import { PLATFORM_DEMO_TOTALS, isPlatformDemoMode } from '@shared/demo/platformDemo';

export function isAdminDemoMode(): boolean {
  return isPlatformDemoMode();
}

/** 最近 n 天日期标签 MM-DD，从左到右由旧到新 */
function lastNDatesMMDD(n: number): string[] {
  const labels: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    labels.push(`${mm}-${dd}`);
  }
  return labels;
}

export function getDemoDashboardTotals() {
  return { ...PLATFORM_DEMO_TOTALS };
}

/** 本周用户/医生注册柱状图 */
export function getDemoRegistrationTrendWeek(): { name: string; 用户注册: number; 医生注册: number }[] {
  const names = lastNDatesMMDD(7);
  /** 工作日抬升、周末略缓，最后一天（今日）为周内峰值 */
  const userByDay = [24, 31, 28, 36, 42, 38, 47];
  const doctorByDay = [4, 5, 3, 6, 7, 5, 8];
  return names.map((name, i) => ({
    name,
    用户注册: userByDay[i] ?? 28,
    医生注册: doctorByDay[i] ?? 5,
  }));
}

/** 今日 24 小时活跃度折线 */
export function getDemoActivityToday24h(): { time: string; 活跃用户: number; 活跃医生: number }[] {
  const rows: { time: string; 活跃用户: number; 活跃医生: number }[] = [];
  for (let h = 0; h < 24; h++) {
    const time = `${String(h).padStart(2, '0')}:00`;
    const morning = 52 * Math.exp(-((h - 9.5) ** 2) / 16);
    const afternoon = 44 * Math.exp(-((h - 15) ** 2) / 20);
    const evening = 38 * Math.exp(-((h - 20.5) ** 2) / 18);
    const lunchDip = -10 * Math.exp(-((h - 12.5) ** 2) / 6);
    const night = h <= 5 ? -10 : h >= 23 ? -6 : 0;
    const 活跃用户 = Math.max(
      6,
      Math.round(22 + morning + afternoon + evening + lunchDip + night),
    );
    const docMorning = 8 + Math.round(0.35 * morning);
    const docAfternoon = 6 + Math.round(0.28 * afternoon);
    const docEvening = 4 + Math.round(0.22 * evening);
    const 活跃医生 = Math.max(
      2,
      Math.min(
        38,
        Math.round((docMorning + docAfternoon + docEvening) / 2.2) + (h >= 8 && h <= 21 ? 2 : 0),
      ),
    );
    rows.push({ time, 活跃用户, 活跃医生 });
  }
  return rows;
}

/** 医生账户页：近 30 天新注册面积图 */
export function getDemoDoctorRegistration30d(): { day: string; 新注册: number }[] {
  const days = lastNDatesMMDD(30);
  return days.map((day, i) => {
    const wave = 4 + Math.round(4.2 * Math.sin(i / 4.2));
    const weekdayBump = i % 7 === 1 || i % 7 === 4 ? 3 : 0;
    const monthEnd = i >= days.length - 3 ? 2 : 0;
    const 新注册 = Math.max(1, wave + weekdayBump + monthEnd + (i % 9 === 0 ? 2 : 0));
    return { day, 新注册 };
  });
}
