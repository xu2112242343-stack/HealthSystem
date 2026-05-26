/**
 * 管理端 / 医生端共用的平台演示开关与汇总数字（需与 adminDemoMock 保持一致）。
 * 开启：?demo=1 | ?demo1=1 | VITE_ADMIN_DEMO=1 | VITE_DOCTOR_DEMO=1
 */

export const PLATFORM_DEMO_TOTALS = {
  users: 3268,
  doctors: 192,
  hospitals: 48,
  articles: 256,
} as const;

/** 与总用户数一致：风险三档人数之和 = 本值 */
export const PLATFORM_DEMO_PATIENT_COHORT = PLATFORM_DEMO_TOTALS.users;

/** 在 314 人示例子集比例上放大至 3268（低/中/高 ≈ 54.5% / 19.7% / 25.8%） */
export const PLATFORM_DEMO_OVERALL_RISK = {
  low: 1779,
  mid: 645,
  high: 844,
} as const;

export type PlatformDemoVennKey = '1' | '2' | '3' | '12' | '13' | '23' | '123';

const COMORBIDITY_BASE_314: Record<PlatformDemoVennKey, number> = {
  '1': 58,
  '2': 48,
  '3': 31,
  '12': 52,
  '13': 38,
  '23': 28,
  '123': 59,
};

/** 将七区互斥划分按比例放大到 targetTotal（默认 3268） */
export function scaleDemoComorbidityRegions(
  targetTotal: number = PLATFORM_DEMO_PATIENT_COHORT,
): Record<PlatformDemoVennKey, number> {
  const keys = Object.keys(COMORBIDITY_BASE_314) as PlatformDemoVennKey[];
  const baseSum = keys.reduce((s, k) => s + COMORBIDITY_BASE_314[k], 0);
  const parts = keys.map((k) => {
    const exact = (COMORBIDITY_BASE_314[k] * targetTotal) / baseSum;
    const floor = Math.floor(exact);
    return { k, v: floor, frac: exact - floor };
  });
  let sum = parts.reduce((s, p) => s + p.v, 0);
  const byFrac = [...parts].sort((a, b) => b.frac - a.frac);
  for (let i = 0; sum < targetTotal && i < byFrac.length; i++) {
    byFrac[i].v += 1;
    sum += 1;
  }
  return Object.fromEntries(parts.map((p) => [p.k, p.v])) as Record<PlatformDemoVennKey, number>;
}

export const PLATFORM_DEMO_COMORBIDITY = scaleDemoComorbidityRegions();

/** @deprecated 使用 PLATFORM_DEMO_PATIENT_COHORT */
export const PLATFORM_DEMO_ANALYZED_PATIENTS = PLATFORM_DEMO_PATIENT_COHORT;

export function isPlatformDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('demo') === '1') return true;
    if (q.get('demo1') === '1') return true;
  } catch {
    /* ignore */
  }
  return import.meta.env.VITE_ADMIN_DEMO === '1' || import.meta.env.VITE_DOCTOR_DEMO === '1';
}
