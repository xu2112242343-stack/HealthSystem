/**
 * 疾病分析可视化：从三病 0/1 + 衍生字段生成各图数据结构（演示队列可复现）
 */

export type RiskTier = 'low' | 'mid' | 'high';

export type DiseaseAnalysisPatient = {
  id: string;
  nafld: 0 | 1;
  t2dm: 0 | 1;
  stroke: 0 | 1;
  /** 空腹血糖 mmol/L（演示连续值） */
  fpg: number;
  nafldTier: RiskTier;
  t2dmTier: RiskTier;
  strokeTier: RiskTier;
  /** 分层图用：脑卒中高风险（患病或分层为高） */
  strokeHighRisk: boolean;
};

function rnd(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function pickTier(idx: number, salt: number, ifPositiveBias: boolean): RiskTier {
  const u = rnd(idx, salt);
  if (ifPositiveBias) {
    if (u < 0.42) return 'high';
    if (u < 0.78) return 'mid';
    return 'low';
  }
  if (u < 0.55) return 'low';
  if (u < 0.85) return 'mid';
  return 'high';
}

export function buildDiseaseCohort(size = 168): DiseaseAnalysisPatient[] {
  const out: DiseaseAnalysisPatient[] = [];
  for (let i = 1; i <= size; i++) {
    /** 与后端合成看板队列接近：保证 P(T2DM|无肝)、径向带等图有足够非零占比 */
    const nafld: 0 | 1 = rnd(i, 1) < 0.48 ? 1 : 0;
    const t2dm: 0 | 1 = nafld ? (rnd(i, 2) < 0.52 ? 1 : 0) : rnd(i, 2) < 0.165 ? 1 : 0;
    const stroke: 0 | 1 =
      nafld && t2dm
        ? rnd(i, 3) < 0.32
          ? 1
          : 0
        : t2dm
          ? rnd(i, 3) < 0.26
            ? 1
            : 0
          : nafld
            ? rnd(i, 3) < 0.14
              ? 1
              : 0
            : rnd(i, 3) < 0.05
              ? 1
              : 0;

    const fpg = t2dm
      ? Number((5.8 + rnd(i, 10) * 4.2).toFixed(1))
      : Number((4.3 + rnd(i, 11) * 1.6).toFixed(1));

    const nafldTier = pickTier(i, 12, nafld === 1);
    const t2dmTier = pickTier(i, 13, t2dm === 1);
    const strokeTier = pickTier(i, 14, stroke === 1);
    const strokeHighRisk = stroke === 1 || strokeTier === 'high';

    out.push({
      id: String(i),
      nafld,
      t2dm,
      stroke,
      fpg,
      nafldTier,
      t2dmTier,
      strokeTier,
      strokeHighRisk,
    });
  }
  return out;
}

const p = (num: number, den: number) => (den > 0 ? num / den : 0);

/** ① 脂肪肝对糖尿病：P(T2DM|有肝) vs P(T2DM|无肝) */
export function chartDmGivenNafld(rows: DiseaseAnalysisPatient[]) {
  const withN = rows.filter((r) => r.nafld === 1);
  const withoutN = rows.filter((r) => r.nafld === 0);
  return [
    { group: '有脂肪肝', prob: Number(p(withN.filter((r) => r.t2dm === 1).length, withN.length).toFixed(3)) },
    { group: '无脂肪肝', prob: Number(p(withoutN.filter((r) => r.t2dm === 1).length, withoutN.length).toFixed(3)) },
  ];
}

/** ② 是否糖尿病对脑卒中高风险比例 */
export function chartStrokeRiskByDm(rows: DiseaseAnalysisPatient[]) {
  const dm = rows.filter((r) => r.t2dm === 1);
  const noDm = rows.filter((r) => r.t2dm === 0);
  return [
    {
      group: '糖尿病',
      stroke_risk: Number(p(dm.filter((r) => r.strokeHighRisk).length, dm.length).toFixed(3)),
    },
    {
      group: '非糖尿病',
      stroke_risk: Number(p(noDm.filter((r) => r.strokeHighRisk).length, noDm.length).toFixed(3)),
    },
  ];
}

function countTier(rows: DiseaseAnalysisPatient[], key: 'nafldTier' | 't2dmTier' | 'strokeTier') {
  let low = 0,
    mid = 0,
    high = 0;
  for (const r of rows) {
    const t = r[key];
    if (t === 'low') low++;
    else if (t === 'mid') mid++;
    else high++;
  }
  return { low, mid, high };
}

/** ③ 各病风险分层人数（堆叠柱） */
export function chartRiskStructure(rows: DiseaseAnalysisPatient[]) {
  const a = countTier(rows, 'nafldTier');
  const b = countTier(rows, 't2dmTier');
  const c = countTier(rows, 'strokeTier');
  return [
    { disease: '脂肪肝', low: a.low, mid: a.mid, high: a.high },
    { disease: '糖尿病', low: b.low, mid: b.mid, high: b.high },
    { disease: '脑卒中', low: c.low, mid: c.mid, high: c.high },
  ];
}

/** ④ 特征贡献（演示：模型重要性风格，和为 1） */
export function chartFactorImportance() {
  return [
    {
      disease: '脂肪肝',
      factors: [
        { name: 'BMI', value: 0.32 },
        { name: '血脂', value: 0.26 },
        { name: '血糖', value: 0.18 },
        { name: '血压', value: 0.14 },
        { name: '饮酒', value: 0.1 },
      ],
    },
    {
      disease: '糖尿病',
      factors: [
        { name: '血糖', value: 0.45 },
        { name: 'BMI', value: 0.3 },
        { name: '血压', value: 0.12 },
        { name: '血脂', value: 0.08 },
        { name: '运动不足', value: 0.05 },
      ],
    },
    {
      disease: '脑卒中',
      factors: [
        { name: '血压', value: 0.38 },
        { name: '血糖', value: 0.22 },
        { name: '血脂', value: 0.18 },
        { name: '年龄因素', value: 0.12 },
        { name: '吸烟', value: 0.1 },
      ],
    },
  ];
}

const BIN_EDGES = [4, 5, 6, 7, 8, 9, 10, 11, 12];

/** ⑤ 血糖分布：按区间计数，糖尿病 vs 非糖尿病 */
export function chartGlucoseDistribution(rows: DiseaseAnalysisPatient[]) {
  const labels: string[] = [];
  for (let b = 0; b < BIN_EDGES.length - 1; b++) {
    labels.push(`${BIN_EDGES[b]}-${BIN_EDGES[b + 1]}`);
  }
  const dm = new Array(labels.length).fill(0);
  const normal = new Array(labels.length).fill(0);
  for (const r of rows) {
    const v = r.fpg;
    let idx = BIN_EDGES.length - 2;
    for (let b = 0; b < BIN_EDGES.length - 1; b++) {
      const lo = BIN_EDGES[b];
      const hi = BIN_EDGES[b + 1];
      const last = b === BIN_EDGES.length - 2;
      if (last ? v >= lo && v <= hi : v >= lo && v < hi) {
        idx = b;
        break;
      }
    }
    if (r.t2dm === 1) dm[idx]++;
    else normal[idx]++;
  }
  return labels.map((range, i) => ({
    range,
    糖尿病组: dm[i],
    非糖尿病组: normal[i],
  }));
}
