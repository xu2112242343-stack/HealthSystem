import type { ComponentType } from 'react';
import type { RiskPredictResponse } from '@/lib/api/riskPredict';

type RiskLevel = 'low' | 'medium' | 'high';
type FactorStatus = 'normal' | 'warning' | 'danger';

export type DiseaseModelShape = {
  id: 'liver' | 'diabetes' | 'stroke';
  shortName: string;
  fullName: string;
  subtitle: string;
  risk: RiskLevel;
  riskLabel: string;
  /** 模型输出概率 0–1 */
  probability: number | null;
  score: number;
  icon: ComponentType<{ className?: string }>;
  accent: 'emerald' | 'red' | 'amber';
  summary: string;
  keyFactors: Array<{
    name: string;
    current: string;
    reference: string;
    status: FactorStatus;
    contribution: number;
    modality: '问卷' | '检验' | '影像';
  }>;
  drivers: string[];
  actions: string[];
  trendData: Record<string, string | number>[];
  trendNote: string;
  trendDirection: 'up' | 'down' | 'flat';
};

function factorStatusFromRank(i: number): FactorStatus {
  if (i === 0) return 'danger';
  if (i < 3) return 'warning';
  return 'normal';
}

function factorModalityLabel(f: {
  modality?: string;
  reference?: string;
  name?: string;
}): '问卷' | '检验' | '影像' {
  const m = f.modality?.trim();
  if (m === '影像' || m === '检验' || m === '问卷') return m;
  const ref = (f.reference || '').toLowerCase();
  const nm = (f.name || '').toLowerCase();
  if (ref.includes('yolo') || ref.includes('影像模型') || nm.includes('影像')) return '影像';
  return '问卷';
}

/** 将后端预测写回静态病种模板（保留 icon、subtitle、趋势等演示字段）。 */
export function mergeRiskIntoDiseases<T extends DiseaseModelShape>(
  base: readonly T[],
  api: RiskPredictResponse,
): T[] {
  return base.map((d) => {
    const slice = api.diseases.find((x) => x.id === d.id);
    if (!slice) return d;
    const keyFactors = slice.topFactors.slice(0, 5).map((f, i) => ({
      name: f.name,
      current: f.current?.trim() ? f.current : '—',
      reference: f.reference?.trim() ? f.reference : '—',
      status: factorStatusFromRank(i),
      contribution: Math.max(0, Math.min(100, Math.round(Number(f.value) * 100))),
      modality: factorModalityLabel(f),
    }));
    return {
      ...d,
      risk: slice.risk,
      riskLabel: slice.riskLabel,
      probability: Number.isFinite(Number(slice.probability)) ? Number(slice.probability) : null,
      score: slice.score,
      keyFactors: keyFactors.length ? keyFactors : d.keyFactors,
      summary:
        slice.risk === 'high'
          ? '模型提示该轴风险偏高，建议尽快就医并结合临床检查确认。'
          : slice.risk === 'medium'
            ? '存在一定可干预空间，建议生活方式干预与定期复查。'
            : '当前该轴相对平稳，请继续保持并随访。',
    };
  });
}
