/**
 * 后端 `compositeIndex` 与单病 `score` 为风险度（越高越危险）。
 * 综合展示采用「健康综合分」：100 - 风险均值，越高表示相对风险越低。
 */
export function riskAverageToHealthComposite(riskAverage: number | null | undefined): number | null {
  if (riskAverage === null || riskAverage === undefined) return null;
  const n = Number(riskAverage);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - n)));
}

/** 单病 `probability` 为 0–1（score≈round(p×100)，与 riskLabel 同源） */
export function formatModelProbabilityText(p: number | null | undefined): string {
  if (p === null || p === undefined) return '—';
  const x = Number(p);
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%（p=${x.toFixed(4)}）`;
}
