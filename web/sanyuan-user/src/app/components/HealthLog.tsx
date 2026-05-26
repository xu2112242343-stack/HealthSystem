import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChartLine, CircleHelp, FileText } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  fetchUserHealthHistoryDetail,
  fetchUserHealthHistoryList,
  type HealthHistoryDetailResponse,
  type HealthHistorySnapshotSummary,
} from '@/lib/api/healthHistory';
import { fetchRiskPredict, type RiskPredictResponse } from '@/lib/api/riskPredict';
import { readAiInterventionClientCache } from '@/lib/api/aiIntervention';
import { fetchUserProfile, type UserProfileResponse } from '@/lib/api/userProfile';
import { initialBasic, initialIndicators, initialLifestyle } from '@/lib/types/questionnaireForm';
import projectLogo from '@/app/project-logo.png';

type DateRange = 'all' | '6m' | '3m' | '1m';
const HEATMAP_MAX_DAYS = 10;
const FORCE_NATIVE_HEATMAP = true;
const MAX_COMPARE_RECORDS = 6;
const TABLE_PAGE_SIZE = 10;
type EChartsLike = {
  init: (el: HTMLDivElement) => {
    setOption: (option: unknown) => void;
    resize: () => void;
    dispose: () => void;
  };
};

declare global {
  interface Window {
    echarts?: EChartsLike;
  }
}

function riskBadgeStyle(level: string) {
  if (level === 'high' || level === '高风险') return 'border-red-200 bg-red-50 text-red-700';
  if (level === 'medium' || level === '中风险') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function riskLabelZh(level: string) {
  if (level === 'high' || level === '高风险') return '高风险';
  if (level === 'medium' || level === '中风险') return '中风险';
  return '低风险';
}

function riskCellClassByLabel(label: string): string {
  if (label === '高风险') return 'bg-red-500 text-white';
  if (label === '中风险') return 'bg-amber-500 text-white';
  return 'bg-emerald-500 text-white';
}

type IndicatorRule = {
  key: string;
  label: string;
  low?: number;
  high?: number;
  lowerIsBetter?: boolean;
};

const IMPORTANT_FACTOR_RULES: IndicatorRule[] = [
  { key: 'sbp', label: '收缩压', high: 140 },
  { key: 'dbp', label: '舒张压', high: 90 },
  { key: 'fpg', label: '空腹血糖', high: 6.1 },
  { key: 'hba1c', label: '糖化血红蛋白', high: 6.5 },
  { key: 'tg', label: '甘油三酯', high: 1.7 },
  { key: 'ldl', label: '低密度脂蛋白', high: 3.4 },
  { key: 'hdl', label: '高密度脂蛋白', low: 1.0, lowerIsBetter: false },
  { key: 'uricAcid', label: '尿酸', high: 420 },
];

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const m = value.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function factorWeightToRosePercent(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const scaled = raw <= 1 ? raw * 100 : raw;
  return Math.min(100, Math.max(0, Number(scaled.toFixed(2))));
}

function factorNameForDisplay(raw: string): string {
  const normalized = raw
    .replace(/\s*[\(（][^)）]*[\)）]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 展示名映射：统一把含糊/重复的原始因子名映射为更友好的中文
  if (normalized.includes('是否曾被医生告知患高血压') || normalized === '高血压') return '是否有高血压';

  return normalized;
}

function toPredictBodyFromSnapshotPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  const hasSections = ['basic', 'lifestyle', 'indicators', 'derived'].some(
    (k) => p[k] && typeof p[k] === 'object',
  );
  if (!hasSections) return p;
  const merged: Record<string, unknown> = {};
  (['basic', 'lifestyle', 'indicators', 'derived'] as const).forEach((section) => {
    const obj = p[section];
    if (obj && typeof obj === 'object') {
      Object.entries(obj as Record<string, unknown>).forEach(([k, v]) => {
        merged[k] = v;
      });
    }
  });
  return merged;
}

function indicatorLevelByRule(rule: IndicatorRule, value: unknown): '偏低' | '正常' | '偏高' | '未知' {
  const n = parseNumber(value);
  if (n == null) return '未知';
  if (rule.lowerIsBetter === false) {
    if (rule.low != null && n < rule.low) return '偏低';
    return '正常';
  }
  if (rule.low != null && n < rule.low) return '偏低';
  if (rule.high != null && n > rule.high) return '偏高';
  return '正常';
}

function healthScoreBySnapshot(s: HealthHistorySnapshotSummary) {
  const avgRisk = (s.probabilities.liver + s.probabilities.diabetes + s.probabilities.stroke) / 3;
  return Number((100 - avgRisk * 100).toFixed(1));
}

function formatDate(iso: string) {
  return iso.slice(0, 10);
}

function inMonthsRange(iso: string, months: number) {
  const now = new Date();
  const cutoff = new Date();
  cutoff.setMonth(now.getMonth() - months);
  return new Date(iso) >= cutoff;
}

function riskLevelFromProb(prob: number): 'low' | 'medium' | 'high' {
  if (prob < 0.3) return 'low';
  if (prob < 0.6) return 'medium';
  return 'high';
}

function riskLabelFromLevel(level: 'low' | 'medium' | 'high'): string {
  if (level === 'high') return '高风险';
  if (level === 'medium') return '中风险';
  return '低风险';
}

function addDays(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function toUtcIsoDate(year: number, month: number, day: number): string {
  // 用 UTC 上午 08:00 避免时区导致日期漂移
  return new Date(Date.UTC(year, month - 1, day, 8, 0, 0)).toISOString();
}

function shouldUseDemoHistory(): boolean {
  const search = new URLSearchParams(window.location.search);
  return search.get('demo_history') === '1';
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function createDemoSnapshots(base: HealthHistorySnapshotSummary[]): HealthHistorySnapshotSummary[] {
  if (base.length === 0) return base;
  if (!shouldUseDemoHistory()) return base;
  const DEMO_INTERVAL_DAYS = 14; // 每两周一次
  const DEMO_TARGET_COUNT = 12;

  const latest = base[base.length - 1]!;
  // 从 2/12 起，每 14 天一条，最多到“今天”为止（不超出当前日期）
  const now = new Date();
  const year = new Date(latest.snapshotAt).getUTCFullYear();
  const startIso = toUtcIsoDate(year, 2, 2);
  const todayIso = toUtcIsoDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  const daysDiff = Math.max(0, Math.floor((new Date(todayIso).getTime() - new Date(startIso).getTime()) / 86400000));
  const targetCount = Math.max(2, Math.floor(daysDiff / DEMO_INTERVAL_DAYS) + 1);

  const syntheticCount = Math.max(0, Math.min(DEMO_TARGET_COUNT, targetCount) - base.length);
  const out: HealthHistorySnapshotSummary[] = [];
  const startLiver = Math.min(0.78, latest.probabilities.liver + 0.32);
  const startDiabetes = Math.min(0.74, latest.probabilities.diabetes + 0.28);
  const startStroke = Math.min(0.7, latest.probabilities.stroke + 0.24);

  for (let i = syntheticCount; i >= 1; i--) {
    const t = i / (syntheticCount + 1);
    // 做一点可视化波动：整体趋势从“更高风险”逐步改善到 latest，并叠加轻微震荡
    const wobble = (phase: number) => Math.sin((1 - t) * Math.PI * 2 + phase) * 0.018;
    const liver = Number(
      clamp(latest.probabilities.liver + (startLiver - latest.probabilities.liver) * t + wobble(0.3), 0, 0.99).toFixed(4),
    );
    const diabetes = Number(
      clamp(latest.probabilities.diabetes + (startDiabetes - latest.probabilities.diabetes) * t + wobble(1.1), 0, 0.99).toFixed(4),
    );
    const stroke = Number(
      clamp(latest.probabilities.stroke + (startStroke - latest.probabilities.stroke) * t + wobble(2.2), 0, 0.99).toFixed(4),
    );
    const pmax = Math.max(liver, diabetes, stroke);
    const level = riskLevelFromProb(pmax);
    const snapshotAt = addDays(latest.snapshotAt, -DEMO_INTERVAL_DAYS * i);
    const nextReviewDate = addDays(snapshotAt, level === 'high' ? 30 : level === 'medium' ? 60 : 90);
    out.push({
      ...latest,
      id: -1000 - i,
      snapshotAt,
      nextReviewDate,
      remainingDays: null,
      isOverdue: false,
      maxRisk: {
        level,
        label: riskLabelFromLevel(level),
        probability: pmax,
      },
      probabilities: { liver, diabetes, stroke },
      riskLevels: {
        liver: riskLevelFromProb(liver),
        diabetes: riskLevelFromProb(diabetes),
        stroke: riskLevelFromProb(stroke),
      },
    });
  }

  const merged = [...out, ...base].sort((a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime());
  // 统一把时间线“归一化”为：2 月 02 日起，每两周一次
  const trimmed =
    merged.length > Math.min(DEMO_TARGET_COUNT, targetCount)
      ? merged.slice(merged.length - Math.min(DEMO_TARGET_COUNT, targetCount))
      : merged;
  const timelineNormalized = trimmed.map((item, idx) => {
    const snapshotAt = addDays(startIso, DEMO_INTERVAL_DAYS * idx);
    // 让“从远到近”呈现风险逐步降低：早期更高风险，越接近当前越低风险
    const n = trimmed.length;
    const t = n <= 1 ? 1 : idx / (n - 1); // 0=最早, 1=最新
    const wobble = (phase: number) => Math.sin(t * Math.PI * 2 + phase) * 0.012;

    // 目标口径：
    // - 糖尿病、肝病：始终低风险（prob < 0.3），保持轻微波动
    // - 脑卒中：从高逐步降低到低（早期高风险 -> 近期低风险）
    // 肝病：仅“最早两条”为中风险；从第三条开始进入低风险（更贴近短期干预后改善）
    const liver = Number(
      (
        idx <= 1
          ? clamp(0.48 - idx * 0.04 + wobble(0.5), 0.34, 0.58) // 中风险段（前两条）
          : clamp(0.26 - (idx - 2) * 0.02 + wobble(0.5), 0.12, 0.28) // 低风险段（其余）
      ).toFixed(4),
    );
    const diabetes = Number(clamp(0.16 + wobble(1.6), 0.07, 0.27).toFixed(4));
    const strokeStart = 0.78; // 早期高风险
    const strokeEnd = 0.45; // 近期中风险
    const stroke = Number(clamp(strokeStart + (strokeEnd - strokeStart) * t + wobble(2.2), 0, 0.99).toFixed(4));
    const pmax = Math.max(liver, diabetes, stroke);
    const maxLevel = riskLevelFromProb(pmax);
    const nextReviewDate = addDays(snapshotAt, maxLevel === 'high' ? 30 : maxLevel === 'medium' ? 60 : 90);
    return {
      ...item,
      snapshotAt,
      nextReviewDate,
      remainingDays: null,
      isOverdue: false,
      maxRisk: {
        level: maxLevel,
        label: riskLabelFromLevel(maxLevel),
        probability: pmax,
      },
      probabilities: { liver, diabetes, stroke },
      riskLevels: {
        liver: riskLevelFromProb(liver),
        diabetes: riskLevelFromProb(diabetes),
        stroke: riskLevelFromProb(stroke),
      },
    };
  });
  return timelineNormalized;
}

function createDemoDetailFromSnapshots(
  ordered: HealthHistorySnapshotSummary[],
  snapshotId: number,
): HealthHistoryDetailResponse {
  const idx = ordered.findIndex((s) => s.id === snapshotId);
  const cur = ordered[Math.max(0, idx)] ?? ordered[ordered.length - 1]!;
  const x = ordered.map((s) => s.snapshotAt.slice(0, 10));

  // 指标做“趋势 + 轻噪声”，范围控制在合理区间
  const mkSeries = (base: number, delta: number, lo: number, hi: number, phase: number) =>
    ordered.map((_, i) => {
      const t = ordered.length <= 1 ? 0 : i / (ordered.length - 1);
      const wobble = Math.sin(t * Math.PI * 2 + phase) * (Math.abs(delta) * 0.18);
      return Number(clamp(base + delta * t + wobble, lo, hi).toFixed(2));
    });

  const series = {
    fpg: mkSeries(7.6, -1.4, 4.6, 10.5, 0.2), // mmol/L
    hba1c: mkSeries(7.4, -1.1, 4.8, 10.5, 1.1), // %
    tg: mkSeries(2.4, -0.8, 0.6, 6.0, 2.1), // mmol/L
    sbp: mkSeries(152, -18, 105, 190, 0.7), // mmHg
  };

  const pick = <T,>(arr: T[]) => (idx >= 0 ? arr[idx] : arr[arr.length - 1]);
  const payload = {
    indicators: {
      fpg: pick(series.fpg),
      hba1c: pick(series.hba1c),
      tg: pick(series.tg),
      sbp: pick(series.sbp),
      dbp: Number(clamp(96 - Math.max(0, idx) * 1.2 + Math.sin((idx + 1) * 0.9) * 1.8, 60, 120).toFixed(0)),
      ldl: Number(clamp(4.1 - Math.max(0, idx) * 0.08 + Math.sin((idx + 2) * 0.6) * 0.12, 1.5, 6.5).toFixed(2)),
      hdl: Number(clamp(0.92 + Math.max(0, idx) * 0.02 + Math.sin((idx + 3) * 0.5) * 0.03, 0.6, 2.2).toFixed(2)),
      uricAcid: Number(clamp(468 - Math.max(0, idx) * 6 + Math.sin((idx + 4) * 0.55) * 12, 260, 620).toFixed(0)),
    },
  };

  return {
    id: cur.id,
    snapshotAt: cur.snapshotAt,
    payload,
    probabilities: cur.probabilities,
    riskLevels: {
      liver: String(cur.riskLevels.liver),
      diabetes: String(cur.riskLevels.diabetes),
      stroke: String(cur.riskLevels.stroke),
    },
    followUpPlan: {
      nextReviewDate: cur.nextReviewDate,
      remainingDays: 14,
      intervalDays: 14,
      scheduleLevel: cur.maxRisk.level,
      scheduleLabel: riskLabelFromLevel(cur.maxRisk.level),
    },
    indicatorTrend: { x, series },
    riskTrend: {
      liver: ordered.map((s) => s.probabilities.liver),
      diabetes: ordered.map((s) => s.probabilities.diabetes),
      stroke: ordered.map((s) => s.probabilities.stroke),
    },
    reminderSuggestions: ['演示数据：建议按两周节奏复查，并观察指标变化趋势。'],
    doctorAdvice: '演示数据：指标总体改善，建议继续控制饮食、规律运动，并按期复查。',
  };
}

function createDemoRiskPredictFromDetail(
  detail: HealthHistoryDetailResponse,
  snapshot: HealthHistorySnapshotSummary | null,
): RiskPredictResponse {
  const indicators = (detail.payload?.indicators || {}) as Record<string, unknown>;
  const getNum = (k: string) => {
    const n = parseNumber(indicators[k]);
    return n == null ? null : n;
  };
  const fpg = getNum('fpg');
  const tg = getNum('tg');
  const ldl = getNum('ldl');
  const sbp = getNum('sbp');
  const ua = getNum('uricAcid');
  const ldh = getNum('ldh');
  const cr = getNum('creatinine'); // 可能没有，演示时允许为空

  const w = (v: number) => clamp(v, 0.08, 0.92); // 因子权重：0~1，避免全 0
  const base = snapshot?.probabilities ?? detail.probabilities;
  const mkDisease = (id: 'liver' | 'diabetes' | 'stroke', shortName: string, fullName: string) => {
    const probability = id === 'liver' ? base.liver : id === 'diabetes' ? base.diabetes : base.stroke;
    const score = Number((100 - probability * 100).toFixed(1));
    const risk = riskLevelFromProb(probability);
    const riskLabel = riskLabelFromLevel(risk);

    const topFactors = [
      { name: '空腹血糖', value: w(fpg == null ? 0.55 : (fpg - 4.6) / 6.0), current: fpg == null ? '—' : `${fpg} mmol/L`, reference: '4.6–6.1', modality: '检验' },
      { name: '甘油三酯', value: w(tg == null ? 0.48 : (tg - 0.6) / 2.6), current: tg == null ? '—' : `${tg} mmol/L`, reference: '<1.7', modality: '检验' },
      { name: '空腹 LDL-C', value: w(ldl == null ? 0.46 : (ldl - 1.5) / 3.5), current: ldl == null ? '—' : `${ldl} mmol/L`, reference: '<3.4', modality: '检验' },
      { name: '收缩压', value: w(sbp == null ? 0.52 : (sbp - 105) / 70), current: sbp == null ? '—' : `${sbp} mmHg`, reference: '<140', modality: '检验' },
      { name: '尿酸', value: w(ua == null ? 0.44 : (ua - 260) / 220), current: ua == null ? '—' : `${ua} μmol/L`, reference: '<420', modality: '检验' },
      { name: '血肌酐', value: w(cr == null ? 0.35 : (cr - 50) / 90), current: cr == null ? '—' : `${cr} μmol/L`, reference: '50–140', modality: '检验' },
      { name: '乳酸脱氢酶 LDH', value: w(ldh == null ? 0.33 : (ldh - 120) / 180), current: ldh == null ? '—' : `${ldh} U/L`, reference: '120–250', modality: '检验' },
      { name: '是否曾被医生告知患高血压/高血压', value: w(sbp != null && sbp >= 140 ? 0.7 : 0.3), current: sbp != null && sbp >= 140 ? '是' : '否', modality: '问卷' },
      { name: '吸烟', value: w(0.32), current: '否', modality: '问卷' },
      { name: '饮酒', value: w(0.28), current: '偶尔', modality: '问卷' },
      { name: '饮酒频率', value: w(0.26), current: '每周 1–2 次', modality: '问卷' },
    ];

    return {
      id,
      shortName,
      fullName,
      probability,
      score,
      risk,
      riskLabel,
      sourceTag: 'demo',
      topFactors,
    };
  };

  return {
    propagationScores: [0.62, 0.44, 0.51],
    compositeIndex: Number(((base.liver + base.diabetes + base.stroke) / 3).toFixed(4)),
    diseases: [
      mkDisease('stroke', '卒中', '脑卒中风险'),
      mkDisease('diabetes', '糖尿病', '糖尿病风险'),
      mkDisease('liver', '肝病', '脂肪肝/肝病风险'),
    ],
    source: { liver: 'demo', diabetes: 'demo', stroke: 'demo' },
  };
}

const PAYLOAD_SECTION_TITLES: Record<string, string> = {
  basic: '基本情况',
  lifestyle: '生活习惯',
  indicators: '检验与体征指标',
  derived: '衍生/计算项',
};

/** 问卷/指标字段 → 中文展示名（与 DataCollection 对齐） */
const REPORT_FIELD_LABEL_ZH: Record<string, string> = {
  age: '年龄',
  gender: '性别',
  height: '身高',
  weight: '体重',
  waist: '腰围',
  hypertension: '高血压',
  myocardialInfarction: '心肌梗死',
  coronaryHeartDisease: '冠心病',
  angina: '心绞痛',
  gestationalDiabetes: '妊娠期糖尿病',
  pcos: '多囊卵巢综合征',
  familyHistoryDiabetes: '糖尿病家族史',
  prediabetes: '糖尿病前期',
  antihypertensiveDrugs: '降压药物',
  hypoglycemicDrugs: '降糖药物',
  symptomPolyuria: '多尿',
  symptomWeightLoss: '不明原因体重减轻',
  symptomThirst: '口渴',
  symptomBlurVision: '视力模糊',
  symptomSlowHealing: '伤口愈合缓慢',
  smoking: '吸烟',
  vigorousExercise: '中高强度运动',
  drinkingFrequency: '饮酒频率',
  scaleAlcoholAmount: '饮酒量评分',
  scaleWeeklyActivity: '每周活动时间',
  scaleDietQuality: '膳食质量',
  scaleSleepQuality: '睡眠质量',
  scaleHealthKnowledge: '健康知识',
  scaleQualityOfLife: '生活质量',
  scaleFatigue: '疲劳程度',
  sedentaryMinutesPerDay: '日均久坐时间',
  sbp: '收缩压',
  dbp: '舒张压',
  fpg: '空腹血糖',
  hba1c: '糖化血红蛋白',
  tg: '甘油三酯',
  tc: '总胆固醇',
  hdl: '高密度脂蛋白胆固醇',
  ldl: '低密度脂蛋白胆固醇',
  alt: '丙氨酸氨基转移酶',
  ast: '天门冬氨酸氨基转移酶',
  ggt: 'γ-谷氨酰转移酶',
  totalBilirubin: '总胆红素',
  albumin: '白蛋白',
  creatinine: '血肌酐',
  bun: '血尿素氮',
  ldh: '乳酸脱氢酶',
  chloride: '氯离子',
  serumIron: '血清铁',
  hematocrit: '红细胞压积',
  rbc: '红细胞计数',
  rdw: '红细胞分布宽度',
  hemoglobin: '血红蛋白',
  lymphocytePct: '淋巴细胞百分比',
  uricAcid: '尿酸',
  map: '平均动脉压',
  bmi: 'BMI',
  tyg: 'TyG 指数',
  altAst: 'ALT/AST',
  tcHdl: 'TC/HDL',
  bri: '体型指数',
};

const SECTION_ROW_ORDER: Record<string, readonly string[]> = {
  basic: Object.keys(initialBasic),
  lifestyle: Object.keys(initialLifestyle),
  indicators: Object.keys(initialIndicators),
  derived: ['bmi', 'map', 'tyg', 'altAst', 'tcHdl', 'bri'],
};

const INDICATOR_VALUE_SUFFIX: Record<string, string> = {
  sbp: ' mmHg',
  dbp: ' mmHg',
  fpg: ' mmol/L',
  hba1c: ' %',
  tg: ' mmol/L',
  tc: ' mmol/L',
  hdl: ' mmol/L',
  ldl: ' mmol/L',
  alt: ' U/L',
  ast: ' U/L',
  ggt: ' U/L',
  totalBilirubin: ' μmol/L',
  albumin: ' g/L',
  creatinine: ' μmol/L',
  bun: ' mmol/L',
  ldh: ' U/L',
  chloride: ' mmol/L',
  serumIron: ' μmol/L',
  hematocrit: ' L/L',
  rbc: ' ×10¹²/L',
  rdw: ' %',
  hemoglobin: ' g/L',
  lymphocytePct: ' %',
  uricAcid: ' μmol/L',
};

const DERIVED_VALUE_SUFFIX: Record<string, string> = {
  map: ' mmHg',
  bmi: ' kg/m²',
  tyg: '',
  altAst: '',
  tcHdl: '',
  bri: '',
};

function fallbackFieldLabelZh(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

function labelForReportField(key: string): string {
  return REPORT_FIELD_LABEL_ZH[key] ?? fallbackFieldLabelZh(key);
}

function orderedPayloadEntries(obj: Record<string, unknown>, preferred: readonly string[]): [string, unknown][] {
  const keys = new Set(Object.keys(obj).filter((k) => !k.startsWith('_')));
  const out: [string, unknown][] = [];
  for (const k of preferred) {
    if (keys.has(k)) {
      out.push([k, obj[k]!]);
      keys.delete(k);
    }
  }
  for (const k of [...keys].sort((a, b) => labelForReportField(a).localeCompare(labelForReportField(b), 'zh-CN'))) {
    out.push([k, obj[k]!]);
  }
  return out;
}

function normalizeScalarString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v).trim();
}

function translateCommonScalar(s: string): string {
  if (!s) return '—';
  const lower = s.toLowerCase();
  if (lower === 'yes' || lower === 'y' || s === '是') return '是';
  if (lower === 'no' || lower === 'n' || s === '否') return '否';
  if (lower === 'male' || s === '男') return '男';
  if (lower === 'female' || s === '女') return '女';
  if (lower === 'unknown' || lower === 'na' || lower === 'n/a') return '—';
  return s;
}

function formatScalarForReport(sectionKey: string, fieldKey: string, v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '—';
    }
  }

  const raw = normalizeScalarString(v);
  if (!raw) return '—';

  if (sectionKey === 'basic') {
    if (fieldKey === 'age') {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return `${Math.round(n)} 岁`;
      return translateCommonScalar(raw);
    }
    if (fieldKey === 'height') {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return `${n} cm`;
    }
    if (fieldKey === 'weight') {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return `${n} kg`;
    }
    if (fieldKey === 'waist') {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return `${n} cm`;
    }
    if (fieldKey === 'gender') return translateCommonScalar(raw);
    return translateCommonScalar(raw);
  }

  if (sectionKey === 'lifestyle') {
    if (fieldKey === 'sedentaryMinutesPerDay') {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return `${n} 分钟/天`;
    }
    return translateCommonScalar(raw);
  }

  if (sectionKey === 'indicators') {
    const suf = INDICATOR_VALUE_SUFFIX[fieldKey];
    if (suf !== undefined) {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return `${n}${suf}`;
    }
    return translateCommonScalar(raw);
  }

  if (sectionKey === 'derived') {
    const suf = DERIVED_VALUE_SUFFIX[fieldKey];
    if (suf !== undefined && raw !== '—') {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return suf ? `${n}${suf}` : String(n);
    }
  }

  return translateCommonScalar(raw);
}

type ReportPayloadSection = { title: string; rows: { label: string; value: string }[] };

function inferSectionForFieldKey(key: string): 'basic' | 'lifestyle' | 'indicators' | 'derived' {
  if ((Object.keys(initialBasic) as string[]).includes(key)) return 'basic';
  if ((Object.keys(initialLifestyle) as string[]).includes(key)) return 'lifestyle';
  if ((Object.keys(initialIndicators) as string[]).includes(key)) return 'indicators';
  if (SECTION_ROW_ORDER.derived.includes(key)) return 'derived';
  return 'indicators';
}

function buildReportPayloadSections(payload: unknown): ReportPayloadSection[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const out: ReportPayloadSection[] = [];
  (['basic', 'lifestyle', 'indicators', 'derived'] as const).forEach((sectionKey) => {
    const obj = p[sectionKey];
    if (!obj || typeof obj !== 'object') return;
    const o = obj as Record<string, unknown>;
    const preferred = SECTION_ROW_ORDER[sectionKey] ?? [];
    const entries = orderedPayloadEntries(o, preferred);
    const rows = entries.map(([key, value]) => ({
      label: labelForReportField(key),
      value: formatScalarForReport(sectionKey, key, value),
    }));
    if (rows.length) out.push({ title: PAYLOAD_SECTION_TITLES[sectionKey] ?? sectionKey, rows });
  });
  if (out.length === 0) {
    const flatPreferred = [
      ...SECTION_ROW_ORDER.basic,
      ...SECTION_ROW_ORDER.lifestyle,
      ...SECTION_ROW_ORDER.indicators,
      ...SECTION_ROW_ORDER.derived,
    ];
    const entries = orderedPayloadEntries(p as Record<string, unknown>, flatPreferred);
    const rows = entries.map(([key, value]) => ({
      label: labelForReportField(key),
      value: formatScalarForReport(inferSectionForFieldKey(key), key, value),
    }));
    if (rows.length) out.push({ title: '问卷与指标', rows });
  }
  return out;
}

/** 报告中部「需关注指标」：重要因子 + 当前值 + 相对参考的高低判断 */
function buildReportWatchlistLines(detail: HealthHistoryDetailResponse): string[] {
  const body = toPredictBodyFromSnapshotPayload(detail.payload);
  const lines: string[] = [];
  for (const rule of IMPORTANT_FACTOR_RULES) {
    const raw = body[rule.key];
    const formatted = formatScalarForReport('indicators', rule.key, raw);
    if (formatted === '—') continue;
    const lv = indicatorLevelByRule(rule, raw);
    const status = lv === '未知' ? '' : `（${lv}）`;
    lines.push(`${rule.label}：${formatted}${status}`);
  }
  return lines;
}

/** 报告抬头下方：姓名（接口优先）+ 年龄性别体成分等 */
function buildReportBasicInfoRows(
  detail: HealthHistoryDetailResponse,
  profile: UserProfileResponse | null,
): { label: string; value: string }[] {
  const p = detail.payload && typeof detail.payload === 'object' ? (detail.payload as Record<string, unknown>) : {};
  const basicRaw = p.basic;
  const b =
    basicRaw && typeof basicRaw === 'object' && !Array.isArray(basicRaw)
      ? (basicRaw as Record<string, unknown>)
      : {};

  const nameFromPayload =
    (typeof b.name === 'string' && b.name.trim()) ||
    (typeof b.patientName === 'string' && b.patientName.trim()) ||
    (typeof p.patientName === 'string' && (p.patientName as string).trim()) ||
    '';
  const nameFromProfile = profile?.name?.trim() || '';
  const displayName = nameFromProfile || nameFromPayload || '—';

  return [
    { label: '姓名', value: displayName },
    { label: '年龄', value: formatScalarForReport('basic', 'age', b.age) },
    { label: '性别', value: formatScalarForReport('basic', 'gender', b.gender) },
    { label: '身高', value: formatScalarForReport('basic', 'height', b.height) },
    { label: '体重', value: formatScalarForReport('basic', 'weight', b.weight) },
    { label: '腰围', value: formatScalarForReport('basic', 'waist', b.waist) },
  ];
}

/**
 * 将 getComputedStyle 的结果写入行内样式，便于在「无 Tailwind 样式表」的 iframe 中仍保持与弹窗一致的布局。
 * 跳过 --* 自定义属性，避免把 Tailwind v4 源样式里的 oklch() 原样带进 html2canvas。
 */
function copyComputedStylesToInline(root: HTMLElement): void {
  const elements: Element[] = [root, ...root.querySelectorAll('*')];
  for (const el of elements) {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    if (el.closest('script, style')) continue;
    const cs = getComputedStyle(el);
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (name.startsWith('--')) continue;
      try {
        const value = cs.getPropertyValue(name);
        if (!value) continue;
        if (/oklch\s*\(|lab\s*\(|lch\s*\(/i.test(value)) continue;
        const priority = cs.getPropertyPriority(name);
        el.style.setProperty(name, value, priority || undefined);
      } catch {
        /* 个别简写与优先级组合在 setProperty 时可能抛错，忽略即可 */
      }
    }
  }
}

function stripClassAndIdForPdfCapture(root: HTMLElement): void {
  const all: Element[] = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    el.removeAttribute('class');
    el.removeAttribute('id');
  }
}

async function renderHealthReportToPdf(source: HTMLElement, filename: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const rect = source.getBoundingClientRect();
  const w = Math.max(Math.ceil(rect.width), 640);

  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('details').forEach((d) => {
    (d as HTMLDetailsElement).open = true;
  });

  const host = document.createElement('div');
  host.setAttribute('data-pdf-style-host', '1');
  host.style.cssText = `position:fixed;left:-9999px;top:0;z-index:-1;opacity:0;pointer-events:none;width:${w}px;overflow:visible;`;
  host.appendChild(clone);
  document.body.appendChild(host);
  void clone.offsetHeight;
  copyComputedStylesToInline(clone);
  stripClassAndIdForPdfCapture(clone);
  document.body.removeChild(host);

  /** html2canvas 无法解析主站 Tailwind v4 样式表中的 oklch()；行内化后在仅含基础字体的 iframe 中截图 */
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-pdf-capture-frame', '1');
  iframe.style.cssText =
    'position:fixed;left:-9999px;top:0;width:900px;height:20000px;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    html,body{margin:0;padding:0;background:#fff;}
    body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;}
    #pdfRoot{box-sizing:border-box;width:${w}px;padding:0;background:#fff;}
  </style></head><body><div id="pdfRoot"></div></body></html>`);
  idoc.close();

  const root = idoc.getElementById('pdfRoot')!;
  const imported = idoc.importNode(clone, true) as HTMLElement;
  imported.style.width = `${w}px`;
  imported.style.boxSizing = 'border-box';
  root.appendChild(imported);

  const imgs = Array.from(imported.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          window.setTimeout(done, 8000);
        }),
    ),
  );

  let canvas: HTMLCanvasElement;
  try {
    try {
      canvas = await html2canvas(imported, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        foreignObjectRendering: false,
        scrollX: 0,
        scrollY: 0,
      });
    } catch {
      canvas = await html2canvas(imported, {
        scale: 1,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        foreignObjectRendering: false,
      });
    }
  } finally {
    iframe.remove();
  }

  if (canvas.width < 2 || canvas.height < 2) {
    throw new Error('截图尺寸异常，请确认报告内容已加载完整后再试。');
  }

  let imgData: string;
  try {
    imgData = canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    imgData = canvas.toDataURL('image/png');
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const fmt = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG';

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, fmt, 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 1) {
    position -= pageHeight;
    pdf.addPage();
    pdf.addImage(imgData, fmt, 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(filename);
}

export function PhysicalExamReportModal(props: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  errorMsg: string | null;
  detail: HealthHistoryDetailResponse | null;
}) {
  const { open, onClose, loading, errorMsg, detail } = props;
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const reportPdfRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setProfile(null);
      return;
    }
    if (!detail) return;
    let cancelled = false;
    void fetchUserProfile()
      .then((r) => {
        if (!cancelled) setProfile(r);
      })
      .catch(() => {
        if (!cancelled) setProfile({ name: null, phone: null, email: null });
      });
    return () => {
      cancelled = true;
    };
  }, [open, detail?.id]);

  if (!open) return null;

  const handleDownloadPdf = async () => {
    if (!detail || !reportPdfRef.current) return;
    setPdfLoading(true);
    try {
      await renderHealthReportToPdf(
        reportPdfRef.current,
        `sanyuan-report-${detail.id}-${formatDate(detail.snapshotAt)}.pdf`,
      );
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(
        `导出 PDF 失败。\n\n常见原因：浏览器禁止跨域像素读取（画布被污染）、报告过长超出画布上限、或隐私模式限制。\n\n本次错误信息：${msg}`,
      );
    } finally {
      setPdfLoading(false);
    }
  };

  const aiRec = readAiInterventionClientCache();
  const sections = detail ? buildReportPayloadSections(detail.payload) : [];
  const watchlistLines = detail ? buildReportWatchlistLines(detail) : [];

  const bullets = (title: string, items: string[]) =>
    items.length === 0 ? null : (
      <div className="mb-4">
        <div className="mb-2 text-sm font-bold text-gray-900">{title}</div>
        <ul className="list-none space-y-2 pl-0 text-sm leading-relaxed text-gray-800">
          {items.map((t, i) => (
            <li key={`${title}-${i}`} className="border-l-2 border-gray-200 pl-3">
              {t}
            </li>
          ))}
        </ul>
      </div>
    );

  const diseaseRows = detail
    ? [
        {
          key: 'liver',
          name: '肝病/脂肪肝风险',
          level: String(detail.riskLevels.liver),
          p: detail.probabilities.liver,
        },
        {
          key: 'diabetes',
          name: '糖尿病风险',
          level: String(detail.riskLevels.diabetes),
          p: detail.probabilities.diabetes,
        },
        {
          key: 'stroke',
          name: '脑卒中风险',
          level: String(detail.riskLevels.stroke),
          p: detail.probabilities.stroke,
        },
      ]
    : [];

  const riskValueClass = (level: string) => {
    const zh = riskLabelZh(level);
    if (zh === '高风险') return 'text-red-700';
    if (zh === '中风险') return 'text-amber-700';
    return 'text-emerald-700';
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pe-report-title"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto border border-gray-300 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute right-3 top-3 z-10 flex gap-2">
          {!loading && !errorMsg && detail ? (
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={pdfLoading}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pdfLoading ? '导出中…' : '下载 PDF'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            关闭
          </button>
        </div>

        {loading ? (
          <div className="p-14 text-center text-gray-600">加载中…</div>
        ) : errorMsg ? (
          <div className="p-14 text-center text-rose-600">{errorMsg}</div>
        ) : detail ? (
          <div ref={reportPdfRef} className="px-6 pb-10 pt-14 text-sm text-gray-900 sm:px-10 md:px-14">
            <header className="border-b-2 border-gray-900 pb-8">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-5">
                <img
                  src={projectLogo}
                  alt="三元智鉴"
                  className="h-14 w-14 shrink-0 rounded-full border border-gray-300 object-cover sm:h-[4.5rem] sm:w-[4.5rem]"
                />
                <div className="min-w-0 text-center">
                  <h2
                    id="pe-report-title"
                    className="text-balance text-lg font-bold tracking-wide text-gray-900 sm:text-xl md:text-2xl"
                  >
                    三元智鉴体检报告书
                  </h2>
                  <p className="mt-2 text-xs leading-snug text-gray-600 sm:text-sm">
                    基于单次健康评估的汇总摘要（非医疗机构正式诊断文书）
                  </p>
                  <p className="mt-1 font-mono text-xs text-gray-500 sm:hidden">评估编号 {detail.id}</p>
                </div>
                <div className="hidden text-right text-xs leading-tight text-gray-600 sm:block">
                  <div>评估编号</div>
                  <div className="mt-1 font-mono text-sm font-medium text-gray-900">{detail.id}</div>
                </div>
              </div>
            </header>

            <section className="mt-8 border border-gray-400 bg-white p-4 sm:p-5">
              <h3 className="mb-4 border-b border-gray-900 pb-1.5 text-sm font-bold text-gray-900">受检者基本情况</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm sm:grid-cols-3 sm:gap-x-6">
                {buildReportBasicInfoRows(detail, profile).map((row) => (
                  <div key={row.label} className="min-w-0 border-b border-gray-100 pb-3 sm:border-0 sm:pb-0">
                    <div className="text-xs text-gray-500">{row.label}</div>
                    <div className="mt-1 break-words font-semibold text-gray-900">{row.value}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-8 border-b border-gray-200 pb-8">
              <h3 className="mb-5 border-b border-gray-900 pb-1.5 text-base font-bold text-gray-900">一、风险评估与需关注指标</h3>

              <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {diseaseRows.map((d) => (
                  <div key={d.key} className="border border-gray-400 bg-white px-3 py-4 text-center shadow-sm">
                    <div className="text-xs text-gray-600">{d.name}</div>
                    <div className={`mt-2 text-lg font-bold ${riskValueClass(d.level)}`}>{riskLabelZh(d.level)}</div>
                    <div className="mt-1.5 text-sm text-gray-500">估算概率 {(d.p * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>

              <h4 className="mb-3 text-sm font-bold text-gray-900">需关注检验与生活指标</h4>
              {watchlistLines.length === 0 ? (
                <p className="text-xs leading-relaxed text-gray-600">
                  当前记录中暂无已填写的重要指标，或尚不足以生成相对参考区间的判断。建议至「健康数据」补全血压、血糖、血脂等信息。
                </p>
              ) : (
                <ul className="space-y-2 border border-gray-400 bg-white p-4 text-sm leading-relaxed text-gray-900">
                  {watchlistLines.map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 font-bold text-gray-900">·</span>
                      <span>
                        <strong className="font-semibold text-gray-900">
                          {line.split('：')[0]}：
                        </strong>
                        {line.includes('：') ? line.slice(line.indexOf('：') + 1) : line}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-8">
              <h3 className="mb-1 border-b border-gray-900 pb-1.5 text-base font-bold text-gray-900">二、干预意见与健康指导</h3>

              {detail.followUpPlan ? (
                <p className="mb-5 mt-4 text-sm leading-relaxed text-gray-800">
                  <strong className="font-semibold text-gray-900">随访计划：</strong>
                  当前分层为「{detail.followUpPlan.scheduleLabel}」；建议间隔约 {detail.followUpPlan.intervalDays}{' '}
                  天复评，下次复评日期为 <strong>{formatDate(detail.followUpPlan.nextReviewDate)}</strong>。
                </p>
              ) : null}

              {detail.reminderSuggestions?.length ? (
                <div className="mb-5">
                  <div className="mb-2 text-sm font-bold text-gray-900">系统提醒</div>
                  <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-gray-800">
                    {detail.reminderSuggestions.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {detail.doctorAdvice ? (
                <div className="mb-6">
                  <div className="mb-2 text-sm font-bold text-gray-900">医生建议</div>
                  <p className="whitespace-pre-wrap border border-gray-400 bg-gray-50 p-4 text-sm leading-relaxed text-gray-800">
                    {detail.doctorAdvice}
                  </p>
                </div>
              ) : null}

              <div className="mb-6">
                <div className="mb-2 text-sm font-bold text-gray-900">其他（干预方案 · AI 建议摘要）</div>
                <p className="mb-3 text-xs leading-relaxed text-gray-600">
                  若您曾在同一会话中打开「干预方案」并成功生成 AI 推荐，下列内容可作为补充参考（与历史各条评估并非严格一一对应）。
                </p>
                {aiRec ? (
                  <div className="border border-gray-400 bg-white p-4 text-sm leading-relaxed text-gray-800">
                    {bullets('要点说明', aiRec.reasons || [])}
                    {aiRec.reason ? <p className="mb-3 text-sm">{aiRec.reason}</p> : null}
                    {bullets('饮食建议', aiRec.diet || [])}
                    {bullets('运动建议', aiRec.exercise || [])}
                    {bullets('生活习惯', aiRec.lifestyle || [])}
                  </div>
                ) : (
                  <p className="border border-dashed border-gray-400 bg-gray-50 p-4 text-xs leading-relaxed text-gray-600">
                    当前未检测到会话内干预方案 AI 缓存。请至「干预方案」页面生成个性化建议后，再打开本报告查看。
                  </p>
                )}
              </div>

              <p className="border-t border-gray-300 pt-4 text-center text-sm leading-relaxed text-gray-500">
                本报告基于用户自报信息与模型估算生成，仅供健康管理与生活方式干预参考，不可替代执业医师面诊及正式医学诊断。
              </p>

              <div className="mt-6 flex justify-end text-sm text-gray-800">
                <span>
                  报告日期：<strong className="font-semibold tracking-tight text-gray-900">{formatDate(detail.snapshotAt)}</strong>
                </span>
              </div>
            </section>

            {sections.length > 0 ? (
              <details className="mt-10 rounded border border-gray-300 bg-gray-50/80 text-sm">
                <summary className="cursor-pointer px-4 py-3 font-semibold text-gray-800 hover:bg-gray-100">
                  附录：详细问卷数据（点击展开）
                </summary>
                <div className="space-y-4 border-t border-gray-300 bg-white p-4">
                  {sections.map((sec) => (
                    <div key={sec.title} className="overflow-hidden rounded border border-gray-200">
                      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-800">{sec.title}</div>
                      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
                        {sec.rows.map((row, idx) => (
                          <div
                            key={`${sec.title}-${idx}-${row.label}`}
                            className="flex flex-col rounded border border-gray-100 px-2 py-1.5"
                          >
                            <span className="text-xs text-gray-500">{row.label}</span>
                            <span className="text-xs font-medium text-gray-900">{row.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 取当前用户最近一次健康评估快照对应的「体检报告书」详情（含演示模式与 demo_history=1 逻辑）。 */
export async function fetchLatestPhysicalExamReportDetail(): Promise<
  | { ok: true; detail: HealthHistoryDetailResponse }
  | { ok: false; error: string }
> {
  try {
    const res = await fetchUserHealthHistoryList();
    let snaps = [...(res.snapshots || [])].sort(
      (a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime(),
    );
    snaps = createDemoSnapshots(snaps);
    if (snaps.length === 0) {
      return {
        ok: false,
        error:
          '暂无评估记录。请先完成「健康数据」与「风险评估」并保存，系统将生成健康档案条目后再查看报告。',
      };
    }
    const ordered = [...snaps].sort((a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime());
    const latest = ordered[ordered.length - 1]!;
    if (shouldUseDemoHistory() && latest.id < 0) {
      return { ok: true, detail: createDemoDetailFromSnapshots(ordered, latest.id) };
    }
    const detail = await fetchUserHealthHistoryDetail(latest.id);
    return { ok: true, detail };
  } catch {
    return { ok: false, error: '加载体检报告失败，请稍后重试。' };
  }
}

export function HealthLog() {
  const riskHeatmapRef = useRef<HTMLDivElement | null>(null);
  const riskHeatmapChartRef = useRef<{
    setOption: (option: unknown) => void;
    resize: () => void;
    dispose: () => void;
  } | null>(null);
  const [snapshots, setSnapshots] = useState<HealthHistorySnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);
  const [heatmapReloadNonce, setHeatmapReloadNonce] = useState(0);
  const [range, setRange] = useState<DateRange>('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareDetails, setCompareDetails] = useState<HealthHistoryDetailResponse[] | null>(null);
  const [compareRiskPredicts, setCompareRiskPredicts] = useState<RiskPredictResponse[] | null>(null);
  const [peReportOpen, setPeReportOpen] = useState(false);
  const [peReportLoading, setPeReportLoading] = useState(false);
  const [peReportError, setPeReportError] = useState<string | null>(null);
  const [peReportDetail, setPeReportDetail] = useState<HealthHistoryDetailResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErrorMsg(null);

    void (async () => {
      try {
        const res = await fetchUserHealthHistoryList();
        if (!mounted) return;
        const sorted = [...(res.snapshots || [])].sort(
          (a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime(),
        );
        setSnapshots(createDemoSnapshots(sorted));
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setErrorMsg('加载健康档案失败，请稍后重试。');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (range === 'all') return snapshots;
    if (range === '6m') return snapshots.filter((s) => inMonthsRange(s.snapshotAt, 6));
    if (range === '3m') return snapshots.filter((s) => inMonthsRange(s.snapshotAt, 3));
    return snapshots.filter((s) => inMonthsRange(s.snapshotAt, 1));
  }, [range, snapshots]);

  const openPhysicalExamReport = useCallback(
    (snapshotId: number) => {
      setPeReportOpen(true);
      setPeReportLoading(true);
      setPeReportError(null);
      setPeReportDetail(null);
      void (async () => {
        try {
          const demoMode = shouldUseDemoHistory();
          if (demoMode && snapshotId < 0) {
            const ordered = [...filtered].sort(
              (a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime(),
            );
            setPeReportDetail(createDemoDetailFromSnapshots(ordered, snapshotId));
          } else {
            const d = await fetchUserHealthHistoryDetail(snapshotId);
            setPeReportDetail(d);
          }
        } catch (e) {
          console.error(e);
          setPeReportError('加载体检报告失败，请稍后重试。');
        } finally {
          setPeReportLoading(false);
        }
      })();
    },
    [filtered],
  );

  const scoreTrendData = useMemo(
    () =>
      filtered.map((s) => ({
        id: s.id,
        date: formatDate(s.snapshotAt),
        score: healthScoreBySnapshot(s),
      })),
    [filtered],
  );

  const insight = useMemo(() => {
    if (scoreTrendData.length < 2) return '数据不足，完成两次评估后可查看改善趋势。';
    const latest = scoreTrendData[scoreTrendData.length - 1]!;
    const prev = scoreTrendData[scoreTrendData.length - 2]!;
    const diff = Number((latest.score - prev.score).toFixed(1));
    if (diff > 0) return `相比上次评估，健康评分提升 ${diff} 分，继续保持。`;
    if (diff < 0) return `相比上次评估，健康评分下降 ${Math.abs(diff)} 分，建议及时调整干预方案。`;
    return '相比上次评估，健康评分保持稳定。';
  }, [scoreTrendData]);

  const selectedRecords = useMemo(
    () => filtered.filter((s) => selectedIds.includes(s.id)),
    [filtered, selectedIds],
  );
  const tableRows = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => new Date(b.snapshotAt).getTime() - new Date(a.snapshotAt).getTime(),
      ),
    [filtered],
  );
  const totalTablePages = Math.max(1, Math.ceil(tableRows.length / TABLE_PAGE_SIZE));
  const pagedTableRows = useMemo(() => {
    const start = (tablePage - 1) * TABLE_PAGE_SIZE;
    return tableRows.slice(start, start + TABLE_PAGE_SIZE);
  }, [tablePage, tableRows]);
  const compareChartData = useMemo(() => {
    if (selectedRecords.length < 2) return null;
    const sorted = [...selectedRecords].sort(
      (x, y) => new Date(x.snapshotAt).getTime() - new Date(y.snapshotAt).getTime(),
    );
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    return {
      score: sorted.map((s, idx) => ({
        name: `记录${idx + 1}`,
        日期: formatDate(s.snapshotAt).slice(5),
        健康评分: healthScoreBySnapshot(s),
      })),
      delta: {
        score: Number((healthScoreBySnapshot(last) - healthScoreBySnapshot(first)).toFixed(1)),
      },
    };
  }, [selectedRecords]);

  const factorStateDistData = useMemo(() => {
    if (!compareDetails || compareDetails.length < 2) return [];
    const rows = [
      { 状态: '偏低' as const },
      { 状态: '正常' as const },
      { 状态: '偏高' as const },
    ] as Array<{ 状态: '偏低' | '正常' | '偏高'; [k: string]: string | number }>;

    compareDetails.forEach((d, idx) => {
      const indicators = (d.payload?.indicators || {}) as Record<string, unknown>;
      const key = `记录${idx + 1}`;
      const bucket = { 偏低: 0, 正常: 0, 偏高: 0 };
      IMPORTANT_FACTOR_RULES.forEach((rule) => {
        const lv = indicatorLevelByRule(rule, indicators[rule.key]);
        if (lv !== '未知') bucket[lv] += 1;
      });
      rows[0][key] = bucket.偏低;
      rows[1][key] = bucket.正常;
      rows[2][key] = bucket.偏高;
    });
    return rows;
  }, [compareDetails]);

  const factorRadarData = useMemo(() => {
    if (!compareRiskPredicts || compareRiskPredicts.length < 2) return [];
    const perRecordImportanceMap = compareRiskPredicts.map((risk) => {
      const byName = new Map<string, number>();
      for (const disease of risk.diseases || []) {
        for (const f of disease.topFactors || []) {
          const v = factorWeightToRosePercent(typeof f.value === 'number' ? f.value : 0);
          byName.set(f.name, Math.max(byName.get(f.name) ?? 0, v));
        }
      }
      return byName;
    });

    // 方案 A：雷达图只画“权重”（0-100，同量纲）。
    // current（如 162 U/L、25.45 等）仅用于 tooltip 展示，避免混用量纲导致图形失真。
    const perRecordCurrentTextMap = compareRiskPredicts.map((risk) => {
      const byName = new Map<string, string>();
      for (const disease of risk.diseases || []) {
        for (const f of disease.topFactors || []) {
          const cur = typeof f.current === 'string' ? f.current.trim() : '';
          if (cur) byName.set(f.name, cur);
        }
      }
      return byName;
    });

    const globalTop = new Map<string, number>();
    perRecordImportanceMap.forEach((m) => {
      m.forEach((v, k) => globalTop.set(k, Math.max(globalTop.get(k) ?? 0, v)));
    });
    const top10 = Array.from(globalTop.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    const rawMatrix = top10.map((name) =>
      compareRiskPredicts.map((_, idx) => perRecordImportanceMap[idx]?.get(name) ?? null),
    );
    const allValues = rawMatrix.flat().filter((v): v is number => v != null);
    const globalMax = allValues.length > 0 ? Math.max(...allValues) : 0;

    return top10.map((name, factorIdx) => {
      const row: Record<string, string | number | null> = { factor: factorNameForDisplay(name) };
      compareRiskPredicts.forEach((_, recordIdx) => {
        const key = `r${recordIdx + 1}`;
        const raw = rawMatrix[factorIdx]?.[recordIdx] ?? null;
        // 使用全局尺度 + sqrt 拉伸，让高权重因素更突出
        const display =
          raw == null || globalMax <= 0
            ? 0
            : Number((Math.sqrt(raw / globalMax) * 100).toFixed(1));
        row[key] = display;
        row[`${key}_raw`] = raw;
        row[`${key}_current`] = perRecordCurrentTextMap[recordIdx]?.get(name) ?? null;
      });
      return row;
    });
  }, [compareRiskPredicts]);

  const toggleSelected = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      if (!checked) return prev.filter((v) => v !== id);
      if (prev.includes(id)) return prev;
      if (prev.length >= MAX_COMPARE_RECORDS) return prev;
      return [...prev, id];
    });
  };

  useEffect(() => {
    setSelectedIds([]);
    setCompareDetails(null);
    setCompareRiskPredicts(null);
    setCompareError(null);
    setTablePage(1);
  }, [range]);

  useEffect(() => {
    if (tablePage > totalTablePages) {
      setTablePage(totalTablePages);
    }
  }, [tablePage, totalTablePages]);

  const fallbackHeatmap = useMemo(() => {
    const source = filtered.slice(-HEATMAP_MAX_DAYS);
    const dates = source.map((s) => formatDate(s.snapshotAt));
    return {
      dates,
      rows: [
        {
          name: '脑卒中风险',
          values: source.map((s) => riskLabelFromLevel(riskLevelFromProb(s.probabilities.stroke))),
        },
        {
          name: '糖尿病风险',
          values: source.map((s) => riskLabelFromLevel(riskLevelFromProb(s.probabilities.diabetes))),
        },
        {
          name: '肝病风险',
          values: source.map((s) => riskLabelFromLevel(riskLevelFromProb(s.probabilities.liver))),
        },
      ],
    };
  }, [filtered]);

  useEffect(() => {
    if (FORCE_NATIVE_HEATMAP) return;
    if (!riskHeatmapRef.current) return;
    if (filtered.length === 0) return;
    const heatmapSource = filtered.slice(-HEATMAP_MAX_DAYS);
    if (heatmapSource.length === 0) return;

    const toRiskLevelCode = (prob: number) => (prob < 0.3 ? 0 : prob < 0.6 ? 1 : 2);
    const toRiskLevelLabel = (prob: number) => (prob < 0.3 ? '低风险' : prob < 0.6 ? '中风险' : '高风险');
    const dates = heatmapSource.map((s) => formatDate(s.snapshotAt));
    const diseases = ['脑卒中风险', '糖尿病风险', '肝病风险'];
    const heatmapData: Array<[number, number, number, string]> = [];

    heatmapSource.forEach((s, dateIndex) => {
      const strokeCode = toRiskLevelCode(s.probabilities.stroke);
      const diabetesCode = toRiskLevelCode(s.probabilities.diabetes);
      const liverCode = toRiskLevelCode(s.probabilities.liver);
      heatmapData.push([dateIndex, 0, strokeCode, toRiskLevelLabel(s.probabilities.stroke)]);
      heatmapData.push([dateIndex, 1, diabetesCode, toRiskLevelLabel(s.probabilities.diabetes)]);
      heatmapData.push([dateIndex, 2, liverCode, toRiskLevelLabel(s.probabilities.liver)]);
    });

    let timeoutId: number | null = null;
    const render = () => {
      const lib = window.echarts;
      if (!lib || !riskHeatmapRef.current) return;
      setHeatmapLoading(false);
      setHeatmapError(null);
      if (!riskHeatmapChartRef.current) {
        riskHeatmapChartRef.current = lib.init(riskHeatmapRef.current);
      }
      const chart = riskHeatmapChartRef.current;
      chart.setOption({
      tooltip: {
        position: 'top',
        formatter: (params: { value: [number, number, number, string] }) => {
          const date = dates[params.value[0]];
          const disease = diseases[params.value[1]];
          const levelText = params.value[3];
          return `${date}<br/>${disease}：${levelText}`;
        },
      },
      grid: {
        left: 80,
        right: 24,
        top: 12,
        bottom: 68,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: {
          rotate: 35,
          color: '#7b8aa0',
        },
      },
      yAxis: {
        type: 'category',
        data: diseases,
        axisLabel: {
          color: '#66758a',
        },
      },
      visualMap: {
        min: 0,
        max: 2,
        orient: 'horizontal',
        left: 'center',
        bottom: 6,
        calculable: false,
        precision: 0,
        dimension: 2,
        textStyle: {
          color: '#63748a',
          fontSize: 12,
        },
        pieces: [
          { value: 0, label: '低风险', color: '#4f9e7a' },
          { value: 1, label: '中风险', color: '#e6a23c' },
          { value: 2, label: '高风险', color: '#d9534f' },
        ],
      },
      series: [
        {
          name: '风险等级',
          type: 'heatmap',
          data: heatmapData,
          label: {
            show: true,
            color: '#ffffff',
            fontSize: 11,
            formatter: (params: { value: [number, number, number, string] }) => params.value[3],
          },
          itemStyle: {
            borderColor: '#ffffff',
            borderWidth: 1.5,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 8,
              shadowColor: 'rgba(0, 0, 0, 0.18)',
            },
          },
        },
      ],
    });
      chart.resize();
      window.requestAnimationFrame(() => chart.resize());
      window.setTimeout(() => chart.resize(), 60);
    };

    if (!window.echarts) {
      setHeatmapLoading(true);
      setHeatmapError(null);
      const scriptId = 'echarts-cdn-script';
      const exists = document.getElementById(scriptId) as HTMLScriptElement | null;
      if (exists) {
        exists.addEventListener('load', render, { once: true });
        exists.addEventListener(
          'error',
          () => {
            setHeatmapLoading(false);
            setHeatmapError('热力图加载失败，请重试');
          },
          { once: true },
        );
      } else {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
        script.async = true;
        script.onload = render;
        script.onerror = () => {
          setHeatmapLoading(false);
          setHeatmapError('热力图加载失败，请重试');
        };
        document.head.appendChild(script);
      }
      timeoutId = window.setTimeout(() => {
        if (!window.echarts) {
          setHeatmapLoading(false);
          setHeatmapError('热力图加载超时，请重试');
        }
      }, 5000);
    } else {
      render();
    }

    const onResize = () => riskHeatmapChartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [filtered, heatmapReloadNonce]);

  useEffect(() => {
    return () => {
      riskHeatmapChartRef.current?.dispose();
      riskHeatmapChartRef.current = null;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">健康档案</h2>
          </div>
          <div className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700">基于评估快照持续追踪</div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center text-sm text-gray-600">
            加载中...
          </div>
        ) : errorMsg ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden />
            <p className="text-sm font-medium text-gray-700">{errorMsg}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden />
            <p className="text-sm font-medium text-gray-700">当前时间范围暂无健康档案</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {[
                { id: 'all', label: '全部记录' },
                { id: '6m', label: '近6个月' },
                { id: '3m', label: '近3个月' },
                { id: '1m', label: '近1个月' },
              ].map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setRange(btn.id as DateRange)}
                  className={`rounded-full px-4 py-1.5 text-sm transition ${
                    range === btn.id ? 'bg-sky-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <ChartLine className="h-4 w-4 text-sky-700" />
                综合健康评分趋势（越高越健康）
              </div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={scoreTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" name="健康评分" stroke="#0369a1" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <ChartLine className="h-4 w-4 text-sky-700" />
                三病风险等级表
              </div>
              {!FORCE_NATIVE_HEATMAP && heatmapLoading ? (
                <div className="mb-2 text-xs text-gray-500">热力图加载中...</div>
              ) : null}
              {!FORCE_NATIVE_HEATMAP && heatmapError ? (
                <div className="mb-2 flex items-center gap-2 text-xs text-rose-600">
                  <span>{heatmapError}，已切换为内置展示</span>
                  <button
                    type="button"
                    className="rounded bg-rose-50 px-2 py-0.5 text-rose-700 hover:bg-rose-100"
                    onClick={() => setHeatmapReloadNonce((v) => v + 1)}
                  >
                    重试
                  </button>
                </div>
              ) : null}
              <div className="rounded-xl border border-[#e5edf4] bg-[#fbfdff] px-0 py-0.5">
                {FORCE_NATIVE_HEATMAP || heatmapError ? (
                  <div className="overflow-x-auto">
                    <table
                      className="border-collapse text-sm"
                      style={{
                        width: `max(100%, ${132 + fallbackHeatmap.dates.length * 68}px)`,
                        tableLayout: 'fixed',
                      }}
                    >
                      <thead>
                        <tr>
                          <th className="px-0.5 py-1 text-left text-gray-500 whitespace-nowrap">风险维度</th>
                          {fallbackHeatmap.dates.map((d) => (
                            <th key={d} className="px-0 py-1 text-center text-gray-500 whitespace-nowrap">{d.slice(5)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fallbackHeatmap.rows.map((row) => (
                          <tr key={row.name}>
                            <td className="px-0.5 py-1 font-medium text-gray-700 whitespace-nowrap">{row.name}</td>
                            {row.values.map((v, i) => (
                              <td key={`${row.name}-${i}`} className="p-0">
                                <div
                                  className={`h-10 w-full border border-white text-center text-sm font-semibold leading-[2.45rem] ${riskCellClassByLabel(v)}`}
                                >
                                  {v}
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div ref={riskHeatmapRef} style={{ width: '100%', height: 310 }} />
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-sm text-gray-700">
                  已选 <span className="font-semibold text-sky-700">{selectedIds.length}</span>/{MAX_COMPARE_RECORDS} 条，至少选 2 条可对比
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedIds.length < 2) return;
                    setCompareOpen(true);
                    setCompareLoading(true);
                    setCompareError(null);
                    setCompareDetails(null);
                    setCompareRiskPredicts(null);
                    void (async () => {
                      try {
                        const demoMode = shouldUseDemoHistory();
                        const hasSynthetic = selectedIds.some((id) => id < 0);
                        const ordered = [...filtered].sort(
                          (a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime(),
                        );

                        const details =
                          demoMode && hasSynthetic
                            ? selectedIds.map((id) => createDemoDetailFromSnapshots(ordered, id))
                            : await Promise.all(selectedIds.map((id) => fetchUserHealthHistoryDetail(id)));
                        const sorted = details.sort(
                          (x, y) => new Date(x.snapshotAt).getTime() - new Date(y.snapshotAt).getTime(),
                        );
                        setCompareDetails(sorted);
                        const byId = new Map(ordered.map((s) => [s.id, s]));
                        const risks =
                          demoMode && hasSynthetic
                            ? sorted.map((d) => createDemoRiskPredictFromDetail(d, byId.get(d.id) ?? null))
                            : await Promise.all(sorted.map((d) => fetchRiskPredict(toPredictBodyFromSnapshotPayload(d.payload))));
                        setCompareRiskPredicts(risks);
                      } catch (e) {
                        console.error(e);
                        setCompareError('加载对比详情失败，请稍后重试。');
                      } finally {
                        setCompareLoading(false);
                      }
                    })();
                  }}
                  disabled={selectedIds.length < 2}
                  className={`rounded-full px-4 py-1.5 text-sm ${
                    selectedIds.length >= 2
                      ? 'bg-sky-700 text-white hover:bg-sky-800'
                      : 'cursor-not-allowed bg-gray-200 text-gray-500'
                  }`}
                >
                  对比所选记录
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-600">
                      <th className="px-3 py-2 font-semibold">评估日期</th>
                      <th className="px-3 py-2 font-semibold">健康评分</th>
                      <th className="px-3 py-2 font-semibold">肝病风险</th>
                      <th className="px-3 py-2 font-semibold">糖尿病风险</th>
                      <th className="px-3 py-2 font-semibold">脑卒中风险</th>
                      <th className="px-3 py-2 font-semibold">体检报告</th>
                      <th className="px-3 py-2 font-semibold">对比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTableRows.map((s) => {
                      const checked = selectedIds.includes(s.id);
                      return (
                        <tr key={s.id} className={`border-b border-gray-100 ${checked ? 'bg-sky-50' : ''}`}>
                          <td className="px-3 py-2 text-gray-800">{formatDate(s.snapshotAt)}</td>
                          <td className="px-3 py-2 font-semibold text-gray-900">{healthScoreBySnapshot(s)}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${riskBadgeStyle(s.riskLevels.liver)}`}>
                              {riskLabelZh(String(s.riskLevels.liver))}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${riskBadgeStyle(s.riskLevels.diabetes)}`}>
                              {riskLabelZh(String(s.riskLevels.diabetes))}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${riskBadgeStyle(s.riskLevels.stroke)}`}>
                              {riskLabelZh(String(s.riskLevels.stroke))}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100"
                              onClick={() => openPhysicalExamReport(s.id)}
                            >
                              查看
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggleSelected(s.id, e.target.checked)}
                              disabled={!checked && selectedIds.length >= MAX_COMPARE_RECORDS}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <div>
                  第 {tablePage}/{totalTablePages} 页，共 {tableRows.length} 条记录
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-gray-200 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={tablePage <= 1}
                    onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    className="rounded border border-gray-200 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={tablePage >= totalTablePages}
                    onClick={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
                  >
                    下一页
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-1 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600 sm:flex-row sm:items-start sm:gap-3">
                <CircleHelp className="mt-0.5 hidden h-4 w-4 shrink-0 sm:block" />
                <div className="space-y-1">
                  <p>至少选择 2 条、最多 {MAX_COMPARE_RECORDS} 条记录，可查看多次健康档案变化。</p>
                  <p>
                    「体检报告」汇总<strong>该条评估</strong>对应的问卷/指标数据，以及本记录中的随访提醒、医生建议；并附带「干预方案」页在当前浏览器会话中缓存的
                    AI 建议（需先在干预方案页生成后才可能显示）。
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {compareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setCompareOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                <FileText className="h-5 w-5 text-sky-700" />
                健康档案对比
              </h3>
              <button type="button" onClick={() => setCompareOpen(false)} className="text-sm text-gray-500 hover:text-gray-700">
                关闭
              </button>
            </div>
            {selectedRecords.length < 2 ? (
              <p className="text-sm text-gray-600">请至少选择两条记录后再进行对比。</p>
            ) : (
              <div className="space-y-4">
                {compareChartData && (
                  <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                    健康评分变化：
                    <span className={`ml-1 font-semibold ${compareChartData.delta.score >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {compareChartData.delta.score >= 0 ? '↑' : '↓'} {Math.abs(compareChartData.delta.score)} 分（首末记录）
                    </span>
                  </div>
                )}

                {compareLoading ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
                    对比内容加载中...
                  </div>
                ) : compareError ? (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-8 text-center text-sm text-rose-700">
                    {compareError}
                  </div>
                ) : compareChartData ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="mb-2 text-sm font-semibold text-gray-900">健康评分对比</div>
                      <div style={{ width: '100%', height: 190 }}>
                        <ResponsiveContainer>
                          <BarChart data={compareChartData.score}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis domain={[0, 100]} />
                            <Tooltip />
                            <Bar dataKey="健康评分" fill="#0369a1" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="mb-2 text-sm font-semibold text-gray-900">重要影响因素状态分布对比</div>
                      <div style={{ width: '100%', height: 190 }}>
                        <ResponsiveContainer>
                          <BarChart data={factorStateDistData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="状态" />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Legend />
                            {(compareDetails || []).map((_, idx) => {
                              const colors = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#14b8a6'];
                              return (
                                <Bar
                                  key={`state-bar-${idx}`}
                                  dataKey={`记录${idx + 1}`}
                                  fill={colors[idx % colors.length]}
                                  radius={[4, 4, 0, 0]}
                                />
                              );
                            })}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                ) : null}

                {!compareLoading && !compareError ? (
                  <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="mb-2 text-sm font-semibold text-gray-900">重要影响因素数值雷达对比</div>
                    <div style={{ width: '100%', height: 360 }}>
                      <ResponsiveContainer>
                        <RadarChart data={factorRadarData} outerRadius="72%">
                          <PolarGrid />
                          <PolarAngleAxis dataKey="factor" tick={{ fontSize: 12 }} />
                          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                          <Tooltip
                            formatter={(value, name, item) => {
                              const dataKey = String((item as { dataKey?: string } | undefined)?.dataKey || '');
                              const raw = (item?.payload?.[`${dataKey}_raw`] as number | null | undefined) ?? null;
                              const cur = (item?.payload?.[`${dataKey}_current`] as string | null | undefined) ?? null;
                              return [
                                raw == null ? '未知' : `${raw}`,
                                `${String(name)}（权重归一化 ${value}${cur ? `；当前值 ${cur}` : ''}）`,
                              ];
                            }}
                          />
                          <Legend />
                          {(compareDetails || []).map((_, idx) => {
                            const colors = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#14b8a6'];
                            const key = `r${idx + 1}`;
                            const dash = ['0', '4 2', '2 2', '6 2', '1 3', '8 3'][idx % 6];
                            return (
                              <Radar
                                key={`radar-${idx}`}
                                name={`记录${idx + 1}`}
                                dataKey={key}
                                stroke={colors[idx % colors.length]}
                                fill={colors[idx % colors.length]}
                                fillOpacity={0.28}
                                strokeWidth={3}
                                strokeOpacity={1}
                                strokeDasharray={dash}
                                dot={{ r: 2 }}
                                isAnimationActive={false}
                              />
                            );
                          })}
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                    {factorRadarData.length === 0 ? (
                      <div className="mt-2 text-sm text-gray-500">暂无可用于对比的影响因素数据。</div>
                    ) : (
                      <div className="mt-2 text-xs text-gray-500">说明：维度取用户首页玫瑰图口径的前十重要影响因素；图形按每条记录内部归一化展示，悬停可看原始值。</div>
                    )}
                    </div>
                ) : null}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {selectedRecords.map((s, idx) => (
                    <div key={s.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
                      <div className="mb-1 font-semibold text-gray-900">记录 {idx + 1}</div>
                      <div className="text-gray-700">日期：{formatDate(s.snapshotAt)}</div>
                      <div className="text-gray-700">健康评分：{healthScoreBySnapshot(s)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <PhysicalExamReportModal
        open={peReportOpen}
        onClose={() => {
          setPeReportOpen(false);
          setPeReportDetail(null);
          setPeReportError(null);
        }}
        loading={peReportLoading}
        errorMsg={peReportError}
        detail={peReportDetail}
      />
    </div>
  );
}
