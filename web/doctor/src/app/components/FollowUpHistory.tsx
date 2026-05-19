import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, UserRound } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { postJson } from '@/lib/api';
import {
  fetchDoctorPatientHealthHistoryDetail,
  fetchDoctorPatientHealthHistoryList,
  fetchDoctorPatientsQuestionnaires,
  type DoctorHealthHistoryDetailResponse,
  type DoctorHealthHistorySnapshotSummary,
  type DoctorPatientRow,
} from '@/lib/api/followUpHistory';

type DiseaseId = 'liver' | 'diabetes' | 'stroke';
type RiskPredictDisease = {
  id: DiseaseId;
  fullName: string;
  score: number;
  riskLabel: string;
  topFactors: Array<{ name: string; value: number; current?: string; reference?: string }>;
};
type RiskPredictResponse = {
  compositeIndex: number;
  diseases: RiskPredictDisease[];
};
const PATIENT_ARCHIVE_SELECTION_KEY = 'doctor_patient_archive_selected_id_v1';

function shouldUseDemoHistory(): boolean {
  const search = new URLSearchParams(window.location.search);
  return search.get('demo_history') === '1';
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function toUtcIsoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day, 8, 0, 0)).toISOString();
}

function addDays(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
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

function createDemoDoctorSnapshots(): DoctorHealthHistorySnapshotSummary[] {
  const DEMO_INTERVAL_DAYS = 14;
  const now = new Date();
  const year = now.getUTCFullYear();
  const startIso = toUtcIsoDate(year, 2, 2);
  const todayIso = toUtcIsoDate(year, now.getUTCMonth() + 1, now.getUTCDate());
  const daysDiff = Math.max(0, Math.floor((new Date(todayIso).getTime() - new Date(startIso).getTime()) / 86400000));
  const count = Math.max(2, Math.floor(daysDiff / DEMO_INTERVAL_DAYS) + 1);

  const snaps: DoctorHealthHistorySnapshotSummary[] = [];
  for (let idx = 0; idx < count; idx++) {
    const snapshotAt = addDays(startIso, DEMO_INTERVAL_DAYS * idx);
    const t = count <= 1 ? 1 : idx / (count - 1); // 0=最早, 1=最新
    const wobble = (phase: number) => Math.sin(t * Math.PI * 2 + phase) * 0.012;

    // 口径：肝病/糖尿病一直低风险；脑卒中从高降到中
    // 肝病：仅“最早两条”为中风险；从第三条开始进入低风险（演示改善趋势）
    const liver = Number(
      (
        idx <= 1
          ? clamp(0.48 - idx * 0.04 + wobble(0.5), 0.34, 0.58) // 中风险段（前两条）
          : clamp(0.26 - (idx - 2) * 0.02 + wobble(0.5), 0.12, 0.28) // 低风险段（其余）
      ).toFixed(4),
    );
    const diabetes = Number(clamp(0.16 + wobble(1.6), 0.07, 0.27).toFixed(4));
    const strokeStart = 0.78;
    const strokeEnd = 0.45;
    const stroke = Number(clamp(strokeStart + (strokeEnd - strokeStart) * t + wobble(2.2), 0, 0.99).toFixed(4));

    const pmax = Math.max(liver, diabetes, stroke);
    const maxLevel = riskLevelFromProb(pmax);
    const nextReviewDate = addDays(snapshotAt, maxLevel === 'high' ? 30 : maxLevel === 'medium' ? 60 : 90);

    snaps.push({
      id: -2000 - idx,
      snapshotAt,
      nextReviewDate,
      remainingDays: null,
      isOverdue: false,
      maxRisk: { level: maxLevel, label: riskLabelFromLevel(maxLevel), probability: pmax },
      probabilities: { liver, diabetes, stroke },
      riskLevels: {
        liver: riskLevelFromProb(liver),
        diabetes: riskLevelFromProb(diabetes),
        stroke: riskLevelFromProb(stroke),
      },
    });
  }
  // 医生端表格按时间倒序展示
  return snaps.sort((a, b) => new Date(b.snapshotAt).getTime() - new Date(a.snapshotAt).getTime());
}

function createDemoDoctorDetailFromSnapshots(
  orderedAsc: DoctorHealthHistorySnapshotSummary[],
  snapshotId: number,
): DoctorHealthHistoryDetailResponse {
  const idx = orderedAsc.findIndex((s) => s.id === snapshotId);
  const cur = orderedAsc[Math.max(0, idx)] ?? orderedAsc[orderedAsc.length - 1]!;
  const x = orderedAsc.map((s) => s.snapshotAt.slice(0, 10));

  const mkSeries = (base: number, delta: number, lo: number, hi: number, phase: number) =>
    orderedAsc.map((_, i) => {
      const t = orderedAsc.length <= 1 ? 0 : i / (orderedAsc.length - 1);
      const wobble = Math.sin(t * Math.PI * 2 + phase) * (Math.abs(delta) * 0.18);
      return Number(clamp(base + delta * t + wobble, lo, hi).toFixed(2));
    });

  const series = {
    fpg: mkSeries(7.4, -1.1, 4.6, 10.5, 0.2),
    hba1c: mkSeries(7.2, -0.9, 4.8, 10.5, 1.1),
    tg: mkSeries(2.3, -0.7, 0.6, 6.0, 2.1),
    sbp: mkSeries(150, -16, 105, 190, 0.7),
  };
  const pick = <T,>(arr: T[]) => (idx >= 0 ? arr[idx] : arr[arr.length - 1]);
  const payload = {
    indicators: {
      fpg: pick(series.fpg),
      hba1c: pick(series.hba1c),
      tg: pick(series.tg),
      sbp: pick(series.sbp),
      dbp: Number(clamp(95 - Math.max(0, idx) * 1.1 + Math.sin((idx + 1) * 0.9) * 1.6, 60, 120).toFixed(0)),
      ldl: Number(clamp(4.0 - Math.max(0, idx) * 0.07 + Math.sin((idx + 2) * 0.6) * 0.12, 1.5, 6.5).toFixed(2)),
      hdl: Number(clamp(0.95 + Math.max(0, idx) * 0.02 + Math.sin((idx + 3) * 0.5) * 0.03, 0.6, 2.2).toFixed(2)),
      uricAcid: Number(clamp(460 - Math.max(0, idx) * 5 + Math.sin((idx + 4) * 0.55) * 12, 260, 620).toFixed(0)),
    },
  };

  const p = cur.probabilities;
  const lvs = {
    liver: String(cur.riskLevels.liver),
    diabetes: String(cur.riskLevels.diabetes),
    stroke: String(cur.riskLevels.stroke),
  };
  return {
    id: cur.id,
    snapshotAt: cur.snapshotAt,
    payload,
    probabilities: p,
    riskLevels: lvs,
    followUpPlan: {
      nextReviewDate: cur.nextReviewDate,
      remainingDays: 14,
      intervalDays: 14,
      scheduleLevel: cur.maxRisk.level,
      scheduleLabel: riskLabelFromLevel(cur.maxRisk.level),
    },
    indicatorTrend: { x, series },
    riskTrend: {
      liver: orderedAsc.map((s) => s.probabilities.liver),
      diabetes: orderedAsc.map((s) => s.probabilities.diabetes),
      stroke: orderedAsc.map((s) => s.probabilities.stroke),
    },
    reminderSuggestions: ['演示患者：按两周节奏随访，观察趋势变化。'],
    doctorAdvice: '演示患者：卒中风险已从高风险下降至中风险，建议持续干预并按期复查。',
  };
}

const COMPLETENESS_FIELDS = [
  'age', 'gender', 'heightCm', 'weightKg', 'waistCm', 'sbp', 'dbp', 'fpg', 'hba1c',
  'tg', 'tc', 'hdl', 'ldl', 'alt', 'ast', 'ggt', 'uricAcid',
] as const;

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'boolean') return true;
  return true;
}

function patientCompleteness(patient: DoctorPatientRow | null): number {
  if (!patient) return 0;
  const filled = COMPLETENESS_FIELDS.reduce((sum, key) => (isFilled(patient[key]) ? sum + 1 : sum), 0);
  return Math.round((filled / COMPLETENESS_FIELDS.length) * 100);
}

function toPredictBody(patient: DoctorPatientRow): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  Object.entries(patient).forEach(([k, v]) => {
    if (k === 'id' || k === 'name' || k === 'patientNo' || k === 'updatedAt') return;
    body[k] = v;
  });
  return body;
}

function maskPatientName(name: string): string {
  const n = String(name || '').trim();
  if (!n) return '匿名用户';
  const chars = Array.from(n);
  if (chars.length <= 1) return `${chars[0]}*`;
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(Math.min(3, chars.length - 2))}${chars[chars.length - 1]}`;
}

function patientGenderLabel(gender: unknown): string {
  const g = String(gender || '').toLowerCase();
  if (g === 'male' || g === '男') return '男';
  if (g === 'female' || g === '女') return '女';
  return '未填写';
}

function patientAgeLabel(age: unknown): string {
  const n = Number(age);
  if (!Number.isFinite(n) || n <= 0) return '未填写';
  return `${Math.round(n)} 岁`;
}

function patientHeightLabel(height: unknown): string {
  const n = Number(height);
  if (!Number.isFinite(n) || n <= 0) return '未填写';
  return `${Math.round(n)} cm`;
}

function patientWeightLabel(weight: unknown): string {
  const n = Number(weight);
  if (!Number.isFinite(n) || n <= 0) return '未填写';
  return `${n.toFixed(1)} kg`;
}

function riskBadgeClass(label: string): string {
  if (label.includes('高')) return 'bg-rose-100 text-rose-700 ring-1 ring-rose-200';
  if (label.includes('中')) return 'bg-amber-100 text-amber-800 ring-1 ring-amber-200';
  return 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200';
}

function riskLevelLabel(level: string): string {
  if (level === 'high' || level.includes('高')) return '高风险';
  if (level === 'medium' || level.includes('中')) return '中风险';
  if (level === 'low' || level.includes('低')) return '低风险';
  return '未知';
}

function riskRank(level: string): number {
  const label = riskLevelLabel(level);
  if (label === '高风险') return 3;
  if (label === '中风险') return 2;
  if (label === '低风险') return 1;
  return 0;
}

function riskTrendText(beforeLevel: string, afterLevel: string): '上升' | '下降' | '持平' {
  const diff = riskRank(afterLevel) - riskRank(beforeLevel);
  if (diff > 0) return '上升';
  if (diff < 0) return '下降';
  return '持平';
}

export function FollowUpHistory() {
  const MAX_COMPARE_RECORDS = 6;
  const TABLE_PAGE_SIZE = 10;
  const [patients, setPatients] = useState<DoctorPatientRow[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [predictLoading, setPredictLoading] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [predictData, setPredictData] = useState<RiskPredictResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySnapshots, setHistorySnapshots] = useState<DoctorHealthHistorySnapshotSummary[]>([]);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareDetails, setCompareDetails] = useState<DoctorHealthHistoryDetailResponse[] | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  useEffect(() => {
    let mounted = true;
    setPatientsLoading(true);
    void (async () => {
      try {
        if (shouldUseDemoHistory()) {
          const demoPatient: DoctorPatientRow = {
            id: '-1',
            name: '演示患者',
            patientNo: 'DEMO-0001',
            updatedAt: new Date().toISOString(),
            age: 56,
            gender: '男',
            heightCm: 172,
            weightKg: 78.5,
            waistCm: 94,
            sbp: 150,
            dbp: 95,
            fpg: 7.4,
            hba1c: 7.2,
            tg: 2.3,
            hdl: 0.95,
            ldl: 4.0,
            uricAcid: 460,
          };
          if (!mounted) return;
          setPatients([demoPatient]);
          setSelectedPatientId(-1);
          return;
        }

        const res = await fetchDoctorPatientsQuestionnaires();
        if (!mounted) return;
        setPatients(res || []);
        const ids = (res || []).map((p) => Number(p.id));
        const rawSaved = window.localStorage.getItem(PATIENT_ARCHIVE_SELECTION_KEY);
        const savedId = rawSaved ? Number(rawSaved) : NaN;
        const restoredId = Number.isFinite(savedId) && ids.includes(savedId) ? savedId : null;
        const fallbackId = res?.[0]?.id ? Number(res[0].id) : null;
        setSelectedPatientId(restoredId ?? fallbackId);
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setPatientsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (shouldUseDemoHistory()) return;
    if (selectedPatientId == null) return;
    window.localStorage.setItem(PATIENT_ARCHIVE_SELECTION_KEY, String(selectedPatientId));
  }, [selectedPatientId]);

  const selectedPatient = useMemo(
    () => patients.find((p) => Number(p.id) === selectedPatientId) ?? null,
    [patients, selectedPatientId],
  );
  const selectedPatientIndex = useMemo(
    () => patients.findIndex((p) => Number(p.id) === selectedPatientId),
    [patients, selectedPatientId],
  );

  useEffect(() => {
    setCompareIds([]);
    setCompareOpen(false);
    setCompareDetails(null);
    setCompareError(null);
    setHistoryPage(1);
    if (!selectedPatientId) {
      setHistorySnapshots([]);
      return;
    }
    let mounted = true;
    setHistoryLoading(true);
    setHistoryError(null);
    void (async () => {
      try {
        if (shouldUseDemoHistory()) {
          const snaps = createDemoDoctorSnapshots();
          if (!mounted) return;
          setHistorySnapshots(snaps);
          return;
        }
        const res = await fetchDoctorPatientHealthHistoryList(selectedPatientId);
        if (!mounted) return;
        const sorted = [...(res.snapshots || [])].sort(
          (a, b) => new Date(b.snapshotAt).getTime() - new Date(a.snapshotAt).getTime(),
        );
        setHistorySnapshots(sorted);
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setHistoryError('加载历史记录失败，请稍后重试。');
        setHistorySnapshots([]);
      } finally {
        if (mounted) setHistoryLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedPatientId]);

  const totalHistoryPages = useMemo(
    () => Math.max(1, Math.ceil(historySnapshots.length / TABLE_PAGE_SIZE)),
    [historySnapshots.length],
  );
  const pagedHistorySnapshots = useMemo(() => {
    const start = (historyPage - 1) * TABLE_PAGE_SIZE;
    return historySnapshots.slice(start, start + TABLE_PAGE_SIZE);
  }, [historyPage, historySnapshots]);

  useEffect(() => {
    if (historyPage > totalHistoryPages) setHistoryPage(totalHistoryPages);
  }, [historyPage, totalHistoryPages]);

  useEffect(() => {
    if (!selectedPatient) return;
    let mounted = true;
    setPredictLoading(true);
    setPredictError(null);
    setPredictData(null);
    void (async () => {
      try {
        if (shouldUseDemoHistory()) {
          // 演示：生成一个可用于“10项影响因子排序图”的响应
          const mkFactor = (name: string, value: number) => ({ name, value, current: undefined, reference: undefined });
          const demo: RiskPredictResponse = {
            compositeIndex: 38.0,
            diseases: [
              {
                id: 'stroke',
                fullName: '脑卒中风险',
                score: 62,
                riskLabel: '中风险',
                topFactors: [
                  mkFactor('收缩压', 0.62),
                  mkFactor('空腹血糖', 0.48),
                  mkFactor('空腹 LDL-C', 0.44),
                  mkFactor('甘油三酯', 0.36),
                  mkFactor('是否有高血压', 0.33),
                ],
              },
              {
                id: 'diabetes',
                fullName: '糖尿病风险',
                score: 82,
                riskLabel: '低风险',
                topFactors: [
                  mkFactor('空腹血糖', 0.26),
                  mkFactor('糖化血红蛋白', 0.22),
                  mkFactor('体重', 0.18),
                  mkFactor('腰围', 0.16),
                  mkFactor('运动频率', 0.12),
                ],
              },
              {
                id: 'liver',
                fullName: '脂肪肝/肝病风险',
                score: 84,
                riskLabel: '低风险',
                topFactors: [
                  mkFactor('甘油三酯', 0.24),
                  mkFactor('BMI', 0.20),
                  mkFactor('ALT', 0.16),
                  mkFactor('AST', 0.14),
                  mkFactor('饮酒频率', 0.12),
                ],
              },
            ],
          };
          if (!mounted) return;
          setPredictData(demo);
          return;
        }
        const res = await postJson<RiskPredictResponse>('/api/risk/predict', toPredictBody(selectedPatient));
        if (!mounted) return;
        setPredictData(res);
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setPredictError('加载患者分数与影响因素失败，请稍后重试。');
      } finally {
        if (mounted) setPredictLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedPatient]);

  const completeness = patientCompleteness(selectedPatient);
  const healthScore = predictData ? Math.max(0, Math.min(100, 100 - Math.round(predictData.compositeIndex))) : null;
  const top10Factors = useMemo(
    () => {
      const rows = (predictData?.diseases ?? [])
        .flatMap((d) =>
          d.topFactors.map((f) => ({
            disease: d.fullName,
            name: f.name,
            value: Math.max(0, Math.min(100, Math.round((f.value || 0) * 100))),
            color: d.id === 'liver' ? '#4f9e7a' : d.id === 'diabetes' ? '#e6a23c' : '#d9534f',
          })),
        )
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
      return rows.map((item, idx) => ({ ...item, rankName: `${idx + 1}. ${item.name}` }));
    },
    [predictData],
  );

  const compareSummaryRows = useMemo(() => {
    if (!compareDetails || compareDetails.length < 2) return [];
    const sequences = {
      liver: compareDetails.map((d) => riskLevelLabel(String(d.riskLevels.liver || ''))),
      diabetes: compareDetails.map((d) => riskLevelLabel(String(d.riskLevels.diabetes || ''))),
      stroke: compareDetails.map((d) => riskLevelLabel(String(d.riskLevels.stroke || ''))),
    };
    return [
      { label: '脂肪肝风险', path: sequences.liver },
      { label: '糖尿病风险', path: sequences.diabetes },
      { label: '脑卒中风险', path: sequences.stroke },
    ].map((item) => {
      const before = item.path[0] || '未知';
      const after = item.path[item.path.length - 1] || '未知';
      const trend = riskTrendText(before, after);
      const trendTone =
        trend === '持平'
          ? 'text-slate-600 bg-slate-100'
          : trend === '下降'
            ? 'text-emerald-700 bg-emerald-100'
            : 'text-rose-700 bg-rose-100';
      return {
        label: item.label,
        path: item.path.join(' → '),
        trend,
        trendTone,
      };
    });
  }, [compareDetails]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-gray-100/80 p-6">
      <section className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-gray-200/80 bg-white shadow-sm">
        <div className="relative border-b border-gray-100 px-7 py-6">
          <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-gradient-to-br from-cyan-200/35 to-teal-200/25 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-gradient-to-br from-emerald-200/30 to-sky-100/20 blur-3xl" />
          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">患者档案</h2>
          </div>
        </div>

        <div className="p-6 sm:p-7">
          <div className="mb-6 rounded-2xl border border-gray-100 bg-gradient-to-r from-slate-50/90 via-white to-cyan-50/30 p-4 shadow-sm ring-1 ring-gray-100/80">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-semibold text-gray-900">患者选择</label>
            </div>
            {patientsLoading ? (
              <div className="text-sm text-gray-600">加载中...</div>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,560px)_1fr] md:items-center">
                <div className="flex items-center gap-2">
                  <select
                    className="w-full rounded-xl border border-teal-200/80 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none ring-teal-200 transition focus:border-teal-300 focus:ring-2"
                    value={selectedPatientId ?? ''}
                    onChange={(e) => setSelectedPatientId(e.target.value ? Number(e.target.value) : null)}
                  >
                    {patients.map((p) => (
                      <option key={p.id} value={Number(p.id)}>
                        {maskPatientName(p.name)}（{p.patientNo}）
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                    onClick={() => {
                      if (patients.length === 0) return;
                      const prevIndex =
                        selectedPatientIndex >= 0
                          ? (selectedPatientIndex - 1 + patients.length) % patients.length
                          : 0;
                      const prevId = Number(patients[prevIndex]?.id);
                      if (Number.isFinite(prevId)) setSelectedPatientId(prevId);
                    }}
                  >
                    上一个
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                    onClick={() => {
                      if (patients.length === 0) return;
                      const nextIndex =
                        selectedPatientIndex >= 0 ? (selectedPatientIndex + 1) % patients.length : 0;
                      const nextId = Number(patients[nextIndex]?.id);
                      if (Number.isFinite(nextId)) setSelectedPatientId(nextId);
                    }}
                  >
                    下一个
                  </button>
                </div>
                <div className="text-xs text-gray-500 md:text-right">
                  共 {patients.length} 位患者可选
                </div>
              </div>
            )}
          </div>

          {selectedPatient ? (
            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                <div className="text-xs text-gray-500">性别</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{patientGenderLabel(selectedPatient.gender)}</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                <div className="text-xs text-gray-500">年龄</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{patientAgeLabel(selectedPatient.age)}</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                <div className="text-xs text-gray-500">身高</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{patientHeightLabel(selectedPatient.heightCm)}</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                <div className="text-xs text-gray-500">体重</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{patientWeightLabel(selectedPatient.weightKg)}</div>
              </div>
            </div>
          ) : null}

          {predictLoading ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center text-sm text-gray-600">
              <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
              正在加载档案分析...
            </div>
          ) : predictError ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center">
              <AlertCircle className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden />
              <p className="text-sm font-medium text-gray-700">{predictError}</p>
            </div>
          ) : !selectedPatient || !predictData ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center text-sm text-gray-600">
              暂无可展示的患者档案数据
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm ring-1 ring-gray-100/80">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <UserRound className="h-4 w-4 text-sky-700" />
                    患者信息完整度
                  </div>
                  <div className="text-4xl font-bold tracking-tight text-gray-900">{completeness}%</div>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full ${completeness >= 80 ? 'bg-emerald-500' : completeness >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`}
                      style={{ width: `${completeness}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm ring-1 ring-gray-100/80">
                  <div className="mb-2 text-sm font-semibold text-gray-900">综合健康分数</div>
                  <div className="text-4xl font-bold tracking-tight text-gray-900">{healthScore ?? '—'}</div>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500"
                      style={{ width: `${healthScore ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm ring-1 ring-gray-100/80">
                <div className="mb-2 text-sm font-semibold text-gray-900">10项健康影响因子排序图</div>
                <div className="mb-3 flex items-center gap-3 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#4f9e7a' }} />肝病</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#e6a23c' }} />糖尿病</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#d9534f' }} />脑卒中</span>
                </div>
                <div style={{ width: '100%', height: Math.max(340, top10Factors.length * 30 + 60) }}>
                  <ResponsiveContainer>
                    <BarChart data={top10Factors} layout="vertical" margin={{ left: 36, right: 24, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="rankName" width={170} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value: number) => [`${value}%`, '影响值']}
                        labelFormatter={(_, payload) => {
                          const row = payload?.[0]?.payload as { disease?: string } | undefined;
                          if (!row) return '';
                          return `${row.disease || ''}`;
                        }}
                      />
                      <Bar dataKey="value" radius={[0, 7, 7, 0]}>
                        {top10Factors.map((entry) => (
                          <Cell key={`${entry.disease}-${entry.rankName}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                {predictData.diseases.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-2xl border border-gray-100 bg-gradient-to-b from-white to-slate-50/40 p-4 shadow-sm ring-1 ring-gray-100/80"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-900">{d.fullName} · 前五影响因素</h3>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${riskBadgeClass(d.riskLabel)}`}>
                        {d.riskLabel}
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {d.topFactors.slice(0, 5).map((f, idx) => (
                        <li
                          key={`${d.id}-${f.name}-${idx}`}
                          className="rounded-xl border border-gray-100 bg-white/90 px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-800">{idx + 1}. {f.name}</span>
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                              {Math.round((f.value || 0) * 100)}%
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm ring-1 ring-gray-100/80">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900">档案记录对比</div>
              <button
                type="button"
                disabled={compareIds.length < 2 || !selectedPatientId || compareLoading}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                onClick={() => {
                  if (!selectedPatientId || compareIds.length < 2) return;
                  setCompareOpen(true);
                  setCompareError(null);
                  setCompareDetails(null);
                  setCompareLoading(true);
                  void (async () => {
                    try {
                      if (shouldUseDemoHistory()) {
                        const snaps = createDemoDoctorSnapshots();
                        const orderedAsc = [...snaps].sort(
                          (a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime(),
                        );
                        const details = compareIds.map((id) => createDemoDoctorDetailFromSnapshots(orderedAsc, id));
                        const sorted = details.sort(
                          (x, y) => new Date(x.snapshotAt).getTime() - new Date(y.snapshotAt).getTime(),
                        );
                        setCompareDetails(sorted);
                        return;
                      }

                      const details = await Promise.all(
                        compareIds.map((id) => fetchDoctorPatientHealthHistoryDetail(selectedPatientId, id)),
                      );
                      const sorted = details.sort(
                        (x, y) => new Date(x.snapshotAt).getTime() - new Date(y.snapshotAt).getTime(),
                      );
                      setCompareDetails(sorted);
                    } catch (e) {
                      console.error(e);
                      setCompareError('加载对比内容失败，请重试。');
                    } finally {
                      setCompareLoading(false);
                    }
                  })();
                }}
              >
                对比所选记录
              </button>
            </div>
            <div className="mb-2 text-xs text-gray-500">至少选 2 条，最多 {MAX_COMPARE_RECORDS} 条</div>

            {historyLoading ? (
              <div className="text-sm text-gray-600">历史记录加载中...</div>
            ) : historyError ? (
              <div className="text-sm text-rose-600">{historyError}</div>
            ) : historySnapshots.length === 0 ? (
              <div className="text-sm text-gray-500">暂无历史记录</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-semibold text-gray-500">
                      <th className="px-2 py-2">选择</th>
                      <th className="px-2 py-2">评估日期</th>
                      <th className="px-2 py-2">脂肪肝风险</th>
                      <th className="px-2 py-2">糖尿病风险</th>
                      <th className="px-2 py-2">脑卒中风险</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedHistorySnapshots.map((snap) => {
                      const checked = compareIds.includes(snap.id);
                      return (
                        <tr key={snap.id} className="border-b border-gray-50">
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setCompareIds((prev) => {
                                  if (prev.includes(snap.id)) return prev.filter((id) => id !== snap.id);
                                  if (prev.length >= MAX_COMPARE_RECORDS) return prev;
                                  return [...prev, snap.id];
                                });
                              }}
                              disabled={!checked && compareIds.length >= MAX_COMPARE_RECORDS}
                            />
                          </td>
                          <td className="px-2 py-2 text-gray-700">
                            {new Date(snap.snapshotAt).toLocaleDateString('zh-CN')}
                          </td>
                          <td className="px-2 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(riskLevelLabel(snap.riskLevels.liver || ''))}`}>
                              {riskLevelLabel(String(snap.riskLevels.liver || ''))}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(riskLevelLabel(snap.riskLevels.diabetes || ''))}`}>
                              {riskLevelLabel(String(snap.riskLevels.diabetes || ''))}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${riskBadgeClass(riskLevelLabel(snap.riskLevels.stroke || ''))}`}>
                              {riskLevelLabel(String(snap.riskLevels.stroke || ''))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  <div>
                    第 {historyPage}/{totalHistoryPages} 页，共 {historySnapshots.length} 条记录
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded border border-gray-200 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      className="rounded border border-gray-200 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={historyPage >= totalHistoryPages}
                      onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {compareOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-xl">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">记录风险对比</h3>
                  <button
                    type="button"
                    className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
                    onClick={() => setCompareOpen(false)}
                  >
                    关闭
                  </button>
                </div>

                {compareLoading ? (
                  <div className="py-10 text-center text-sm text-gray-600">对比内容加载中...</div>
                ) : compareError ? (
                  <div className="py-10 text-center text-sm text-rose-600">{compareError}</div>
                ) : !compareDetails || compareDetails.length < 2 ? (
                  <div className="py-10 text-center text-sm text-gray-500">暂无可对比的记录</div>
                ) : (
                  <>
                    <div className="mb-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-gray-700">
                      对比区间：{new Date(compareDetails[0].snapshotAt).toLocaleDateString('zh-CN')} →{' '}
                      {new Date(compareDetails[compareDetails.length - 1]!.snapshotAt).toLocaleDateString('zh-CN')}
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {compareSummaryRows.map((row) => (
                        <div
                          key={row.label}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2"
                        >
                          <div className="text-sm font-medium text-gray-900">{row.label}</div>
                          <div className="text-sm text-gray-700">
                            {row.path}
                          </div>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${row.trendTone}`}>
                            {row.trend}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
