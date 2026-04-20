import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText,
  CheckCircle2,
  Plus,
  Eye,
  Sparkles,
  ChevronRight,
  User,
  Activity,
  Heart,
  Calculator,
  Info,
  Upload,
  Image as ImageIcon,
  AlertCircle,
  Waves,
  Brain,
  Loader2,
  CloudUpload,
  X,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { cn } from '@/app/components/ui/utils';
import {
  initialBasic,
  initialIndicators,
  initialLifestyle,
  type BasicState,
  type IndicatorsState,
  type LifestyleState,
} from '@/lib/types/questionnaireForm';
import {
  loadQuestionnaireSnapshot,
  QUESTIONNAIRE_UPDATED_EVENT,
  saveQuestionnaireSnapshot,
} from '@/lib/questionnaireSnapshot';
import { getScopedQuestionnaireCompletionKey } from '@/lib/questionnaireStorageKeys';
import { ApiError, getStoredAccessToken } from '@/lib/api';
import { fetchAppAccess } from '@/lib/api/appAccess';
import { fetchUserQuestionnaireFromServer, saveUserQuestionnaireToServer } from '@/lib/api/userQuestionnaire';
import { useStoredAccessToken } from '@/lib/useStoredAccessToken';
import {
  deleteUserAxisImage,
  fetchUserAxisImageBlob,
  fetchUserAxisImageMeta,
  uploadUserAxisImage,
  type UserAxis,
} from '@/lib/api/userImages';

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-gray-500 mt-1 flex items-start gap-1">
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{children}</span>
    </p>
  );
}

function YesNoRow({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const groupId = `yn-${id}`;
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm">
      <p id={groupId} className="text-sm font-medium text-gray-900 leading-relaxed">
        {label}
      </p>
      {hint && <Hint>{hint}</Hint>}
      <div
        className="mt-3 flex gap-1 rounded-xl bg-gray-100 p-1"
        role="radiogroup"
        aria-labelledby={groupId}
      >
        <button
          type="button"
          role="radio"
          aria-checked={value === 'yes'}
          onClick={() => onChange('yes')}
          className={cn(
            'flex-1 min-h-10 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2',
            value === 'yes'
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md'
              : 'text-gray-500 hover:bg-white/80 hover:text-gray-800',
          )}
        >
          是
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === 'no'}
          onClick={() => onChange('no')}
          className={cn(
            'flex-1 min-h-10 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2',
            value === 'no'
              ? 'bg-gradient-to-r from-slate-600 to-slate-700 text-white shadow-md'
              : 'text-gray-500 hover:bg-white/80 hover:text-gray-800',
          )}
        >
          否
        </button>
      </div>
    </div>
  );
}

function parseNum(s: string): number | null {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function buildDerivedForServer(derived: ReturnType<typeof computeDerived>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  if (derived.map) out.map = derived.map;
  if (derived.bmi) out.bmi = derived.bmi;
  if (derived.tyg) out.tyg = derived.tyg;
  if (derived.altAst) out.altAst = derived.altAst;
  if (derived.tcHdl) out.tcHdl = derived.tcHdl;
  if (derived.bri) out.bri = derived.bri;
  return Object.keys(out).length > 0 ? out : undefined;
}

function computeDerived(basic: BasicState, ind: IndicatorsState) {
  const hM = parseNum(basic.height);
  const wKg = parseNum(basic.weight);
  const waistCm = parseNum(basic.waist);
  const sbp = parseNum(ind.sbp);
  const dbp = parseNum(ind.dbp);
  const fpg = parseNum(ind.fpg);
  const tg = parseNum(ind.tg);
  const tc = parseNum(ind.tc);
  const hdl = parseNum(ind.hdl);
  const alt = parseNum(ind.alt);
  const ast = parseNum(ind.ast);

  let map: string | null = null;
  if (sbp !== null && dbp !== null) {
    map = ((sbp + 2 * dbp) / 3).toFixed(1);
  }

  let bmi: string | null = null;
  if (hM && wKg && hM > 0) {
    const m = hM / 100;
    bmi = (wKg / (m * m)).toFixed(2);
  }

  let tyg: string | null = null;
  if (tg !== null && tg > 0 && fpg !== null && fpg > 0) {
    tyg = Math.log((tg * fpg) / 2).toFixed(3);
  }

  let altAst: string | null = null;
  if (alt !== null && ast !== null && ast !== 0) {
    altAst = (alt / ast).toFixed(3);
  }

  let tcHdl: string | null = null;
  if (tc !== null && hdl !== null && hdl !== 0) {
    tcHdl = (tc / hdl).toFixed(3);
  }

  let bri: string | null = null;
  if (waistCm && hM && hM > 0) {
    const wM = waistCm / 100;
    const heightM = hM / 100;
    const num =
      1 - Math.pow(wM / (2 * Math.PI), 2) / Math.pow(heightM / 2, 2);
    if (num >= 0 && num <= 1) {
      bri = (364.2 - 365.5 * Math.sqrt(num)).toFixed(2);
    }
  }

  return { map, bmi, tyg, altAst, tcHdl, bri };
}

type ImagingCategory = 'liver' | 'diabetes' | 'stroke';

const initialImagingFiles: Record<ImagingCategory, File[]> = {
  liver: [],
  diabetes: [],
  stroke: [],
};

type ImagingRemote = {
  meta: Record<ImagingCategory, { exists: boolean; filename?: string; mimeType?: string; url?: string }>;
  previewUrl: Record<ImagingCategory, string | null>;
  loading: Record<ImagingCategory, boolean>;
  error: Record<ImagingCategory, string | null>;
};

type StoredCompletion = {
  basicCompleted: boolean;
  lifestyleCompleted: boolean;
  indicatorsCompleted: boolean;
  imagingCounts: Record<ImagingCategory, number>;
  updatedAt: number;
};

const defaultStoredCompletion: StoredCompletion = {
  basicCompleted: false,
  lifestyleCompleted: false,
  indicatorsCompleted: false,
  imagingCounts: { liver: 0, diabetes: 0, stroke: 0 },
  updatedAt: 0,
};

function readStoredCompletion(): StoredCompletion {
  try {
    if (typeof window === 'undefined') return defaultStoredCompletion;
    const raw = window.localStorage.getItem(getScopedQuestionnaireCompletionKey());
    if (!raw) return defaultStoredCompletion;
    const parsed = JSON.parse(raw) as Partial<StoredCompletion>;
    return {
      ...defaultStoredCompletion,
      ...parsed,
      imagingCounts: {
        liver: Number(parsed.imagingCounts?.liver ?? 0),
        diabetes: Number(parsed.imagingCounts?.diabetes ?? 0),
        stroke: Number(parsed.imagingCounts?.stroke ?? 0),
      },
      updatedAt: Number(parsed.updatedAt ?? 0),
    };
  } catch {
    return defaultStoredCompletion;
  }
}

function questionnaireSectionHasData(section: Record<string, string>): boolean {
  return Object.values(section).some((v) => String(v ?? '').trim() !== '');
}

export function DataCollection() {
  const accessToken = useStoredAccessToken();
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);
  const [cloudInfo, setCloudInfo] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const [basicCompleted, setBasicCompleted] = useState(false);
  const [lifestyleCompleted, setLifestyleCompleted] = useState(false);
  const [indicatorsCompleted, setIndicatorsCompleted] = useState(false);
  const [imagingCompleted, setImagingCompleted] = useState(false);

  const [showBasicForm, setShowBasicForm] = useState(false);
  const [showLifestyleForm, setShowLifestyleForm] = useState(false);
  const [showIndicatorsForm, setShowIndicatorsForm] = useState(false);
  const [showImagingForm, setShowImagingForm] = useState(false);
  const [showDerivedPanel, setShowDerivedPanel] = useState(false);

  const [imagingFiles, setImagingFiles] = useState<Record<ImagingCategory, File[]>>(initialImagingFiles);
  const [imagingRemote, setImagingRemote] = useState<ImagingRemote>(() => ({
    meta: { liver: { exists: false }, diabetes: { exists: false }, stroke: { exists: false } },
    previewUrl: { liver: null, diabetes: null, stroke: null },
    loading: { liver: false, diabetes: false, stroke: false },
    error: { liver: null, diabetes: null, stroke: null },
  }));

  const [basic, setBasic] = useState<BasicState>(() => loadQuestionnaireSnapshot()?.basic ?? initialBasic);
  const [lifestyle, setLifestyle] = useState<LifestyleState>(
    () => loadQuestionnaireSnapshot()?.lifestyle ?? initialLifestyle,
  );
  const [indicators, setIndicators] = useState<IndicatorsState>(
    () => loadQuestionnaireSnapshot()?.indicators ?? initialIndicators,
  );

  const persistCompletion = (patch: Partial<StoredCompletion>) => {
    try {
      if (typeof window === 'undefined') return;
      const prev = readStoredCompletion();
      const next: StoredCompletion = {
        ...prev,
        ...patch,
        imagingCounts: {
          ...prev.imagingCounts,
          ...(patch.imagingCounts ?? {}),
        },
        updatedAt: Date.now(),
      };
      window.localStorage.setItem(getScopedQuestionnaireCompletionKey(), JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(QUESTIONNAIRE_UPDATED_EVENT));
    } catch {
      // ignore: localStorage may be unavailable
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveQuestionnaireSnapshot(basic, lifestyle, indicators);
    }, 450);
    return () => window.clearTimeout(t);
  }, [basic, lifestyle, indicators]);

  const persistCompletionRef = React.useRef(persistCompletion);
  persistCompletionRef.current = persistCompletion;

  /** 根据服务端各轴影像 meta 同步「影像上传」完成度与 localStorage 计数（不依赖是否打开影像弹窗）。 */
  const syncImagingMetaFromServer = useCallback(async () => {
    if (!getStoredAccessToken()) return;
    const axes: ImagingCategory[] = ['liver', 'diabetes', 'stroke'];
    const counts: Record<ImagingCategory, number> = { liver: 0, diabetes: 0, stroke: 0 };
    await Promise.all(
      axes.map(async (ax) => {
        try {
          const meta = await fetchUserAxisImageMeta(ax as UserAxis);
          if (meta.exists) counts[ax] = 1;
        } catch {
          /* 单轴失败不影响其它轴 */
        }
      }),
    );
    const any = counts.liver > 0 || counts.diabetes > 0 || counts.stroke > 0;
    setImagingCompleted(any);
    persistCompletionRef.current({ imagingCounts: counts });
  }, []);

  useEffect(() => {
    if (!accessToken) return undefined;
    void syncImagingMetaFromServer();
    return undefined;
  }, [accessToken, syncImagingMetaFromServer]);

  /** 随 JWT 变化拉取当前账号的问卷；换号时先清空本地表单，避免显示上一用户数据。 */
  useEffect(() => {
    let cancelled = false;

    const resetToEmpty = () => {
      setBasic(initialBasic);
      setLifestyle(initialLifestyle);
      setIndicators(initialIndicators);
      setBasicCompleted(false);
      setLifestyleCompleted(false);
      setIndicatorsCompleted(false);
      setImagingCompleted(false);
      setImagingFiles({ liver: [], diabetes: [], stroke: [] });
      saveQuestionnaireSnapshot(initialBasic, initialLifestyle, initialIndicators);
      persistCompletionRef.current({
        basicCompleted: false,
        lifestyleCompleted: false,
        indicatorsCompleted: false,
        imagingCounts: { liver: 0, diabetes: 0, stroke: 0 },
      });
    };

    if (!accessToken) {
      resetToEmpty();
      return undefined;
    }

    resetToEmpty();

    void (async () => {
      try {
        const data = await fetchUserQuestionnaireFromServer();
        if (cancelled) return;
        setBasic(data.basic);
        setLifestyle(data.lifestyle);
        setIndicators(data.indicators);
        saveQuestionnaireSnapshot(data.basic, data.lifestyle, data.indicators);
        const patch: Partial<StoredCompletion> = {};
        if (questionnaireSectionHasData(data.basic)) {
          setBasicCompleted(true);
          patch.basicCompleted = true;
        }
        if (questionnaireSectionHasData(data.lifestyle)) {
          setLifestyleCompleted(true);
          patch.lifestyleCompleted = true;
        }
        if (questionnaireSectionHasData(data.indicators)) {
          setIndicatorsCompleted(true);
          patch.indicatorsCompleted = true;
        }
        if (Object.keys(patch).length > 0) {
          persistCompletionRef.current(patch);
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return;
        if (e instanceof ApiError) setCloudError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;
    const loadRemoteImages = async () => {
      if (!showImagingForm) return;
      if (!accessToken) {
        setImagingRemote((s) => ({
          ...s,
          meta: { liver: { exists: false }, diabetes: { exists: false }, stroke: { exists: false } },
          previewUrl: { liver: null, diabetes: null, stroke: null },
          error: { liver: null, diabetes: null, stroke: null },
        }));
        return;
      }
      const axes: ImagingCategory[] = ['liver', 'diabetes', 'stroke'];
      for (const ax of axes) {
        setImagingRemote((s) => ({
          ...s,
          loading: { ...s.loading, [ax]: true },
          error: { ...s.error, [ax]: null },
        }));
        try {
          const meta = await fetchUserAxisImageMeta(ax as UserAxis);
          if (cancelled) return;
          if (!meta.exists) {
            setImagingRemote((s) => ({
              ...s,
              meta: { ...s.meta, [ax]: { exists: false } },
              previewUrl: { ...s.previewUrl, [ax]: null },
            }));
          } else if (meta.mimeType?.startsWith('image/')) {
            const blob = await fetchUserAxisImageBlob(ax as UserAxis);
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            setImagingRemote((s) => {
              // 清理旧 URL，避免内存泄漏
              const prev = s.previewUrl[ax];
              if (prev) URL.revokeObjectURL(prev);
              return {
                ...s,
                meta: { ...s.meta, [ax]: meta },
                previewUrl: { ...s.previewUrl, [ax]: url },
              };
            });
          } else {
            setImagingRemote((s) => ({
              ...s,
              meta: { ...s.meta, [ax]: meta },
              previewUrl: { ...s.previewUrl, [ax]: null },
            }));
          }
        } catch (e) {
          if (cancelled) return;
          setImagingRemote((s) => ({
            ...s,
            error: { ...s.error, [ax]: e instanceof Error ? e.message : '加载失败' },
            meta: { ...s.meta, [ax]: { exists: false } },
            previewUrl: { ...s.previewUrl, [ax]: null },
          }));
        } finally {
          if (!cancelled) {
            setImagingRemote((s) => ({ ...s, loading: { ...s.loading, [ax]: false } }));
          }
        }
      }
    };
    void loadRemoteImages();
    return () => {
      cancelled = true;
    };
  }, [accessToken, showImagingForm]);

  const derived = useMemo(() => computeDerived(basic, indicators), [basic, indicators]);

  const isFemale = basic.gender === 'female';

  const getProgress = () => {
    let n = 0;
    if (basicCompleted) n++;
    if (lifestyleCompleted) n++;
    if (indicatorsCompleted) n++;
    if (imagingCompleted) n++;
    return (n / 4) * 100;
  };

  const canAnalyze =
    basicCompleted ||
    lifestyleCompleted ||
    indicatorsCompleted ||
    imagingCompleted;

  /** 将当前问卷快照提交到后端 user_info（需 Bearer 令牌）。各模块「保存」与顶部按钮共用。 */
  const pushQuestionnaireRemote = useCallback(async (): Promise<boolean> => {
    setCloudMessage(null);
    setCloudInfo(null);
    setCloudError(null);
    if (!getStoredAccessToken()) {
      if (import.meta.env.DEV) {
        console.warn(
          '[健康数据] 未检测到 localStorage.med_api_access_token_v1，已跳过写入数据库。' +
            '请关闭用户端标签，从门户重新登录并跳转（跳转瞬间地址栏可能有 med_auth=…，进入后会被清掉，这是正常的）。' +
            '勿用「仅打开 localhost:5171」代替门户跳转；门户与用户端须同为 localhost 或同为 127.0.0.1。',
        );
      }
      setCloudInfo(
        '数据已保存在本浏览器。写入数据库需要访问令牌：请从门户登录并自动进入用户端（进入后地址栏会恢复干净，令牌在浏览器的本地存储里）。若仍失败，请确认门户与用户端域名一致（同为 localhost 或同为 127.0.0.1），勿混用。',
      );
      return false;
    }
    setCloudSyncing(true);
    try {
      await saveUserQuestionnaireToServer({
        basic,
        lifestyle,
        indicators,
        derived: buildDerivedForServer(derived),
      });
      setCloudMessage('问卷已保存到您的账户（数据库）。');
      window.dispatchEvent(new CustomEvent(QUESTIONNAIRE_UPDATED_EVENT));
      return true;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : '同步失败';
      setCloudError(msg);
      return false;
    } finally {
      setCloudSyncing(false);
    }
  }, [basic, lifestyle, indicators, derived]);

  const syncQuestionnaireToAccount = () => {
    void pushQuestionnaireRemote();
  };

  const analyzeNow = () => {
    void (async () => {
      const ok = await pushQuestionnaireRemote();
      if (!ok) return;
      try {
        const { fullNavigation } = await fetchAppAccess();
        if (!fullNavigation) {
          setCloudError(
            '数据已保存，但尚未达到解锁浏览条件。请至少完善基础信息、生活方式或体检指标中任一类，或上传至少一类医学影像后再试。',
          );
          return;
        }
      } catch {
        setCloudError('无法确认服务端数据状态，请稍后重试。');
        return;
      }
      window.dispatchEvent(new CustomEvent('navigate', { detail: 'riskAssessment' }));
    })();
  };

  const appendImagingFiles = async (key: ImagingCategory, list: FileList | null) => {
    if (!list?.length) return;
    // 由于后端在 user_info 里每轴只存一个路径：这里采用“覆盖保存最后选择的一个文件”
    const f = list[list.length - 1];
    setImagingRemote((s) => ({
      ...s,
      loading: { ...s.loading, [key]: true },
      error: { ...s.error, [key]: null },
    }));
    try {
      await uploadUserAxisImage(key as UserAxis, f);
      // 本地列表只保留 1 个
      setImagingFiles((prev) => ({ ...prev, [key]: [f] }));
      // 刷新 meta/预览
      const meta = await fetchUserAxisImageMeta(key as UserAxis);
      if (meta.exists && meta.mimeType?.startsWith('image/')) {
        const blob = await fetchUserAxisImageBlob(key as UserAxis);
        const url = URL.createObjectURL(blob);
        setImagingRemote((s) => {
          const prevUrl = s.previewUrl[key];
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          return {
            ...s,
            meta: { ...s.meta, [key]: meta },
            previewUrl: { ...s.previewUrl, [key]: url },
          };
        });
      } else {
        setImagingRemote((s) => ({
          ...s,
          meta: { ...s.meta, [key]: meta },
          previewUrl: { ...s.previewUrl, [key]: null },
        }));
      }
    } catch (e) {
      setImagingRemote((s) => ({
        ...s,
        error: { ...s.error, [key]: e instanceof Error ? e.message : '上传失败' },
      }));
    } finally {
      setImagingRemote((s) => ({ ...s, loading: { ...s.loading, [key]: false } }));
    }
    // 成功或失败后均与服务端对齐一次完成度（失败时不改库，计数与完成态仍正确）
    void syncImagingMetaFromServer();
  };

  const removeImagingFile = (key: ImagingCategory, index: number) => {
    setImagingFiles((prev) => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== index),
    }));
  };

  const derivedRows = [
    {
      key: 'map',
      name: 'MAP',
      formula: '(SBP+2×DBP)/3',
      unit: 'mmHg',
      value: derived.map,
      scope: '卒中',
    },
    {
      key: 'bmi',
      name: 'BMI',
      formula: 'kg/m²',
      unit: 'kg/m²',
      value: derived.bmi,
      scope: '通用',
    },
    {
      key: 'tyg',
      name: 'TyG',
      formula: 'ln(TG×FPG/2)',
      unit: '—',
      value: derived.tyg,
      scope: '脂肪肝',
    },
    {
      key: 'altAst',
      name: 'ALT/AST',
      formula: 'ALT÷AST',
      unit: '—',
      value: derived.altAst,
      scope: '脂肪肝',
    },
    {
      key: 'tcHdl',
      name: 'TC/HDL',
      formula: 'TC÷HDL',
      unit: '—',
      value: derived.tcHdl,
      scope: '脂肪肝',
    },
    {
      key: 'bri',
      name: 'BRI',
      formula: '体圆度',
      unit: '—',
      value: derived.bri,
      scope: '脂肪肝',
    },
  ];

  const savedModuleCount = [basicCompleted, lifestyleCompleted, indicatorsCompleted, imagingCompleted].filter(
    Boolean,
  ).length;
  const moduleSteps = [
    { key: 'basic', label: '基础信息', ok: basicCompleted },
    { key: 'life', label: '生活习惯', ok: lifestyleCompleted },
    { key: 'ind', label: '生理指标', ok: indicatorsCompleted },
    { key: 'img', label: '影像上传', ok: imagingCompleted },
  ] as const;
  const pct = getProgress();

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-4 pt-2 sm:px-6 sm:pb-6 sm:pt-3">
      <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-md ring-1 ring-gray-100/80">
        <div className="relative overflow-hidden border-b border-gray-100/90">
          <div
            className="pointer-events-none absolute -right-24 -top-20 h-56 w-56 rounded-full bg-emerald-400/12 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-teal-400/10 blur-3xl"
            aria-hidden
          />
          <div className="relative px-5 py-6 sm:px-8 sm:py-7">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20 ring-4 ring-white/80">
                    <FileText className="h-6 w-6" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">健康数据</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600 sm:text-[15px]">
                      多维问卷采集、影像资料与检验指标结构化录入，支撑风险评估与干预建议（请按模块逐项保存）。
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2" role="list" aria-label="问卷模块完成状态">
                  {moduleSteps.map((s) => (
                    <span
                      key={s.key}
                      role="listitem"
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        s.ok
                          ? 'border-emerald-200/90 bg-emerald-50/90 text-emerald-900 ring-1 ring-emerald-100/80'
                          : 'border-gray-200/90 bg-white/90 text-gray-600 ring-1 ring-gray-100/80',
                      )}
                    >
                      {s.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                      ) : (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" aria-hidden />
                      )}
                      {s.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:items-end lg:min-w-[12rem]">
                <button
                  type="button"
                  onClick={() => void syncQuestionnaireToAccount()}
                  disabled={cloudSyncing}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-emerald-500/15 transition-all hover:shadow-lg hover:shadow-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-5"
                >
                  {cloudSyncing ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                  ) : (
                    <CloudUpload className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  同步问卷到账户
                </button>
                {cloudMessage ? (
                  <p className="text-xs font-medium text-emerald-700 sm:text-right">{cloudMessage}</p>
                ) : null}
                {cloudInfo ? (
                  <p className="max-w-xs text-xs leading-relaxed text-amber-900/90 sm:text-right">{cloudInfo}</p>
                ) : null}
                {cloudError ? (
                  <p className="max-w-xs text-xs text-rose-600 sm:text-right" role="alert">
                    {cloudError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100/80 bg-gradient-to-b from-slate-50/90 to-white px-5 py-5 sm:px-8 sm:py-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">采集完成度</p>
              <p className="mt-1 flex items-baseline gap-0.5 tabular-nums">
                <span className="text-3xl font-bold text-emerald-700 sm:text-4xl">{pct.toFixed(0)}</span>
                <span className="text-lg font-semibold text-gray-400">%</span>
              </p>
            </div>
            <p className="pb-1 text-sm text-gray-600">
              已保存模块{' '}
              <span className="font-semibold text-gray-900">{savedModuleCount}</span>
              <span className="text-gray-400"> / </span>4
            </p>
          </div>
          <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white shadow-inner ring-1 ring-slate-200/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-5">
        <ModuleCard
          icon={<User className="w-6 h-6 text-white" />}
          iconClass="from-blue-500 to-cyan-600"
          title="基础信息"
          desc="20 项 · 人口学、体测、病史与症状"
          done={basicCompleted}
          onOpen={() => setShowBasicForm(true)}
        />
        <ModuleCard
          icon={<Activity className="w-6 h-6 text-white" />}
          iconClass="from-purple-500 to-pink-600"
          title="生活习惯"
          desc="11 项 · 烟酒运动、自评 0–10、久坐"
          done={lifestyleCompleted}
          onOpen={() => setShowLifestyleForm(true)}
        />
        <ModuleCard
          icon={<Heart className="w-6 h-6 text-white" />}
          iconClass="from-orange-500 to-red-600"
          title="生理指标"
          desc="24 项 · 血压血糖血脂、肝肾、血常规等"
          done={indicatorsCompleted}
          onOpen={() => setShowIndicatorsForm(true)}
        />
        <ModuleCard
          icon={<Upload className="w-6 h-6 text-white" />}
          iconClass="from-green-500 to-emerald-600"
          title="影像上传"
          desc="肝病超声 · 糖网眼底 · 卒中脑 CT · 多图/DICOM"
          done={imagingCompleted}
          onOpen={() => setShowImagingForm(true)}
        />
        <ModuleCard
          icon={<Calculator className="w-6 h-6 text-white" />}
          iconClass="from-teal-500 to-emerald-700"
          title="衍生指标"
          desc="MAP / BMI / TyG 等，自动计算"
          done={false}
          isDerived
          onOpen={() => setShowDerivedPanel(true)}
        />
      </div>

      {showBasicForm && (
        <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-md ring-1 ring-gray-100/80">
          <div
            className="h-1 w-full bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500"
            aria-hidden
          />
          <div className="relative overflow-hidden border-b border-gray-100/90">
            <div
              className="pointer-events-none absolute -right-16 -top-12 h-40 w-40 rounded-full bg-blue-400/10 blur-3xl"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -bottom-16 left-1/3 h-36 w-36 rounded-full bg-emerald-400/10 blur-3xl"
              aria-hidden
            />
            <div className="relative flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-7 sm:py-6">
              <div className="flex min-w-0 flex-1 gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-lg shadow-blue-500/20 ring-2 ring-white/90">
                  <User className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">问卷模块</p>
                  <h2 className="mt-0.5 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">基础信息</h2>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600">
                    共 20 项：人口学与体测、心血管与糖代谢病史、用药与典型症状。逐项填写后点击保存，将写入本机并与账户同步（若已登录）。
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBasicForm(false)}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-full border border-gray-200/90 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 shadow-sm ring-1 ring-gray-100/80 transition-colors hover:border-gray-300 hover:bg-slate-50 hover:text-gray-900"
              >
                <X className="h-4 w-4" aria-hidden />
                收起
              </button>
            </div>
          </div>

          <div className="space-y-6 px-5 py-6 sm:px-7 sm:py-7">
            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-cyan-600"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">人口学信息与体格测量</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 1–5
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
                <div className="rounded-lg border border-slate-200/60 bg-white p-4 shadow-sm ring-1 ring-slate-50">
                  <Label className="leading-relaxed text-gray-800">1. 您的年龄（岁）</Label>
                  <Input
                    type="number"
                    min={0}
                    className="mt-2 rounded-lg border-slate-200/90 shadow-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/25"
                    placeholder="例如：35"
                    value={basic.age}
                    onChange={(e) => setBasic({ ...basic, age: e.target.value })}
                  />
                </div>
                <div className="rounded-lg border border-slate-200/60 bg-white p-4 shadow-sm ring-1 ring-slate-50">
                  <Label className="leading-relaxed text-gray-800">2. 您的性别</Label>
                  <Select
                    value={basic.gender || undefined}
                    onValueChange={(v) => setBasic({ ...basic, gender: v })}
                  >
                    <SelectTrigger className="mt-2 w-full rounded-lg border-slate-200/90 shadow-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/25">
                      <SelectValue placeholder="请选择" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">男</SelectItem>
                      <SelectItem value="female">女</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-lg border border-slate-200/60 bg-white p-4 shadow-sm ring-1 ring-slate-50">
                  <Label className="leading-relaxed text-gray-800">3. 身高（cm）</Label>
                  <Input
                    type="number"
                    step={0.1}
                    className="mt-2 rounded-lg border-slate-200/90 shadow-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/25"
                    placeholder="例：175.5"
                    value={basic.height}
                    onChange={(e) => setBasic({ ...basic, height: e.target.value })}
                  />
                </div>
                <div className="rounded-lg border border-slate-200/60 bg-white p-4 shadow-sm ring-1 ring-slate-50">
                  <Label className="leading-relaxed text-gray-800">4. 体重（kg）</Label>
                  <Input
                    type="number"
                    step={0.1}
                    className="mt-2 rounded-lg border-slate-200/90 shadow-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/25"
                    placeholder="例：65.0"
                    value={basic.weight}
                    onChange={(e) => setBasic({ ...basic, weight: e.target.value })}
                  />
                </div>
                <div className="rounded-lg border border-slate-200/60 bg-white p-4 shadow-sm ring-1 ring-slate-50 md:col-span-2">
                  <Label className="leading-relaxed text-gray-800">5. 腰围（cm）</Label>
                  <Input
                    type="number"
                    step={0.1}
                    className="mt-2 max-w-full rounded-lg border-slate-200/90 shadow-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/25 md:max-w-md"
                    placeholder="例：85.0"
                    value={basic.waist}
                    onChange={(e) => setBasic({ ...basic, waist: e.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-rose-500 to-red-600"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">心血管相关（是 / 否）</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 6–9
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <YesNoRow
                  id="htn"
                  label="6. 是否患有高血压"
                  value={basic.hypertension}
                  onChange={(v) => setBasic({ ...basic, hypertension: v })}
                />
                <YesNoRow
                  id="mi"
                  label="7. 是否患有心肌梗死"
                  value={basic.myocardialInfarction}
                  onChange={(v) => setBasic({ ...basic, myocardialInfarction: v })}
                />
                <YesNoRow
                  id="chd"
                  label="8. 是否患有冠心病"
                  value={basic.coronaryHeartDisease}
                  onChange={(v) => setBasic({ ...basic, coronaryHeartDisease: v })}
                />
                <YesNoRow
                  id="angina"
                  label="9. 是否患有心绞痛"
                  value={basic.angina}
                  onChange={(v) => setBasic({ ...basic, angina: v })}
                />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-amber-500 to-orange-600"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">糖代谢相关（是 / 否）</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 10–20
                </span>
              </div>
              {!isFemale && basic.gender === 'male' && (
                <p className="mb-4 rounded-xl border border-amber-200/80 bg-amber-50/90 p-3.5 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-100/80">
                  10、11 题仅女性；当前为男可跳过。
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {isFemale && (
                  <>
                    <YesNoRow
                      id="gdm"
                      label="10. 是否有妊娠糖尿病病史（女性填写）"
                      value={basic.gestationalDiabetes}
                      onChange={(v) => setBasic({ ...basic, gestationalDiabetes: v })}
                    />
                    <YesNoRow
                      id="pcos"
                      label="11. 是否患有多囊卵巢综合征（女性填写）"
                      value={basic.pcos}
                      onChange={(v) => setBasic({ ...basic, pcos: v })}
                    />
                  </>
                )}
                <YesNoRow
                  id="fhdm"
                  label="12. 家族中是否有糖尿病患者"
                  value={basic.familyHistoryDiabetes}
                  onChange={(v) => setBasic({ ...basic, familyHistoryDiabetes: v })}
                />
                <YesNoRow
                  id="pre"
                  label="13. 是否处于糖尿病前期"
                  value={basic.prediabetes}
                  onChange={(v) => setBasic({ ...basic, prediabetes: v })}
                />
                <YesNoRow
                  id="ah"
                  label="14. 目前是否在使用降压药物"
                  value={basic.antihypertensiveDrugs}
                  onChange={(v) => setBasic({ ...basic, antihypertensiveDrugs: v })}
                />
                <YesNoRow
                  id="hypo"
                  label="15. 目前是否在使用降糖药物"
                  value={basic.hypoglycemicDrugs}
                  onChange={(v) => setBasic({ ...basic, hypoglycemicDrugs: v })}
                />
                <YesNoRow
                  id="pu"
                  label="16. 是否经常出现尿频"
                  value={basic.symptomPolyuria}
                  onChange={(v) => setBasic({ ...basic, symptomPolyuria: v })}
                />
                <YesNoRow
                  id="wl"
                  label="17. 是否有不明原因体重减轻"
                  value={basic.symptomWeightLoss}
                  onChange={(v) => setBasic({ ...basic, symptomWeightLoss: v })}
                />
                <YesNoRow
                  id="thirst"
                  label="18. 是否经常感到过度口渴"
                  value={basic.symptomThirst}
                  onChange={(v) => setBasic({ ...basic, symptomThirst: v })}
                />
                <YesNoRow
                  id="vision"
                  label="19. 是否偶尔出现视力模糊"
                  value={basic.symptomBlurVision}
                  onChange={(v) => setBasic({ ...basic, symptomBlurVision: v })}
                />
                <YesNoRow
                  id="heal"
                  label="20. 是否存在伤口愈合缓慢"
                  value={basic.symptomSlowHealing}
                  onChange={(v) => setBasic({ ...basic, symptomSlowHealing: v })}
                />
              </div>
            </section>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-gray-100/90 bg-slate-50/40 px-5 py-5 sm:flex-row sm:justify-end sm:gap-4 sm:px-7 sm:py-5">
            <button
              type="button"
              onClick={() => setShowBasicForm(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300/90 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-100/80 transition-colors hover:border-gray-400 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                setBasicCompleted(true);
                persistCompletion({ basicCompleted: true });
                setShowBasicForm(false);
                void pushQuestionnaireRemote();
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition-all hover:from-emerald-600 hover:to-teal-700 hover:shadow-lg hover:shadow-emerald-500/30"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {showLifestyleForm && (
        <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-md ring-1 ring-gray-100/80">
          <div
            className="h-1 w-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-600"
            aria-hidden
          />
          <div className="relative overflow-hidden border-b border-gray-100/90">
            <div
              className="pointer-events-none absolute -right-16 -top-12 h-40 w-40 rounded-full bg-purple-400/10 blur-3xl"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -bottom-16 left-1/3 h-36 w-36 rounded-full bg-pink-400/10 blur-3xl"
              aria-hidden
            />
            <div className="relative flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-7 sm:py-6">
              <div className="flex min-w-0 flex-1 gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-lg shadow-purple-500/20 ring-2 ring-white/90">
                  <Activity className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">问卷模块</p>
                  <h2 className="mt-0.5 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">生活习惯</h2>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600">
                    共 11 项：烟酒与中高强度运动、饮酒频率与久坐时间，以及 7 道 0～10 分自评。填写后保存，将写入本机并与账户同步（若已登录）。
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLifestyleForm(false)}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-full border border-gray-200/90 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 shadow-sm ring-1 ring-gray-100/80 transition-colors hover:border-gray-300 hover:bg-slate-50 hover:text-gray-900"
              >
                <X className="h-4 w-4" aria-hidden />
                收起
              </button>
            </div>
          </div>

          <div className="space-y-6 px-5 py-6 sm:px-7 sm:py-7">
            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-purple-500 to-violet-600"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">烟酒与运动（是 / 否）</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 1–2
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
                <YesNoRow
                  id="smoke"
                  label="1. 是否吸烟"
                  value={lifestyle.smoking}
                  onChange={(v) => setLifestyle({ ...lifestyle, smoking: v })}
                />
                <YesNoRow
                  id="vig"
                  label="2. 是否进行每次不少于 10 分钟的中高强度运动"
                  value={lifestyle.vigorousExercise}
                  onChange={(v) => setLifestyle({ ...lifestyle, vigorousExercise: v })}
                />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-fuchsia-500 to-pink-600"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">饮酒与久坐</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 3 · 11
                </span>
              </div>
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-6">
                <div className="rounded-lg border border-slate-200/60 bg-white p-4 shadow-sm ring-1 ring-slate-50">
                  <Label className="text-sm font-medium leading-relaxed text-gray-800">3. 饮酒频率</Label>
                  <Select
                    value={lifestyle.drinkingFrequency || undefined}
                    onValueChange={(v) => setLifestyle({ ...lifestyle, drinkingFrequency: v })}
                  >
                    <SelectTrigger className="mt-2 h-auto min-h-11 w-full rounded-lg border-slate-200/90 py-2 text-left whitespace-normal shadow-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/25">
                      <SelectValue placeholder="请选择" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 — 从不饮酒</SelectItem>
                      <SelectItem value="1">1 — 轻度（每周约 1 次）</SelectItem>
                      <SelectItem value="2">2 — 中度（每周 1～3 次）</SelectItem>
                      <SelectItem value="3">3 — 重度（≥4 次/周或大量饮酒）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-lg border border-slate-200/60 bg-white p-4 shadow-sm ring-1 ring-slate-50">
                  <Label className="text-sm font-medium leading-relaxed text-gray-800">
                    11. 典型一天久坐时间（分钟，不含睡眠）
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    className="mt-2 w-full rounded-lg border-slate-200/90 shadow-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/25"
                    placeholder="例：480"
                    value={lifestyle.sedentaryMinutesPerDay}
                    onChange={(e) => setLifestyle({ ...lifestyle, sedentaryMinutesPerDay: e.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-pink-500 to-rose-600"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">自评量表（0～10 分）</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 4–10
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
                {[
                  { k: 'scaleAlcoholAmount' as const, n: 4, t: '饮酒量主观评分' },
                  { k: 'scaleWeeklyActivity' as const, n: 5, t: '每周身体活动水平' },
                  { k: 'scaleDietQuality' as const, n: 6, t: '膳食质量' },
                  { k: 'scaleSleepQuality' as const, n: 7, t: '睡眠质量' },
                  { k: 'scaleHealthKnowledge' as const, n: 8, t: '健康知识掌握' },
                  { k: 'scaleQualityOfLife' as const, n: 9, t: '生活质量' },
                  { k: 'scaleFatigue' as const, n: 10, t: '疲劳程度' },
                ].map(({ k, n, t }) => (
                  <div
                    key={k}
                    className="rounded-lg border border-slate-200/60 bg-white p-4 shadow-sm ring-1 ring-slate-50"
                  >
                    <Label className="leading-relaxed text-gray-800">
                      {n}. {t}
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      step={1}
                      className="mt-2 rounded-lg border-slate-200/90 shadow-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/25"
                      placeholder="0～10"
                      value={lifestyle[k]}
                      onChange={(e) => setLifestyle({ ...lifestyle, [k]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-gray-100/90 bg-slate-50/40 px-5 py-5 sm:flex-row sm:justify-end sm:gap-4 sm:px-7 sm:py-5">
            <button
              type="button"
              onClick={() => setShowLifestyleForm(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300/90 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-100/80 transition-colors hover:border-gray-400 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                setLifestyleCompleted(true);
                persistCompletion({ lifestyleCompleted: true });
                setShowLifestyleForm(false);
                void pushQuestionnaireRemote();
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition-all hover:from-emerald-600 hover:to-teal-700 hover:shadow-lg hover:shadow-emerald-500/30"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {showIndicatorsForm && (
        <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-md ring-1 ring-gray-100/80">
          <div
            className="h-1 w-full bg-gradient-to-r from-orange-500 via-red-500 to-rose-600"
            aria-hidden
          />
          <div className="relative overflow-hidden border-b border-gray-100/90">
            <div
              className="pointer-events-none absolute -right-16 -top-12 h-40 w-40 rounded-full bg-orange-400/10 blur-3xl"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -bottom-16 left-1/3 h-36 w-36 rounded-full bg-rose-400/10 blur-3xl"
              aria-hidden
            />
            <div className="relative flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-7 sm:py-6">
              <div className="flex min-w-0 flex-1 gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-lg shadow-orange-500/20 ring-2 ring-white/90">
                  <Heart className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">问卷模块</p>
                  <h2 className="mt-0.5 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">生理指标</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
                    共 24 项，名称与单位与国内常见检验报告单一致，请对照化验单逐项填写；保存后将写入本机并与账户同步（若已登录）。
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIndicatorsForm(false)}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-full border border-gray-200/90 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 shadow-sm ring-1 ring-gray-100/80 transition-colors hover:border-gray-300 hover:bg-slate-50 hover:text-gray-900"
              >
                <X className="h-4 w-4" aria-hidden />
                收起
              </button>
            </div>
          </div>

          <div className="space-y-6 px-5 py-6 sm:px-7 sm:py-7">
            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-orange-500 to-amber-600"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">血压与糖代谢</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 1–4
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
                <NumField
                  label="1. 收缩压（mmHg）"
                  placeholder="例：120.0"
                  value={indicators.sbp}
                  onChange={(v) => setIndicators({ ...indicators, sbp: v })}
                />
                <NumField
                  label="2. 舒张压（mmHg）"
                  placeholder="例：80.0"
                  value={indicators.dbp}
                  onChange={(v) => setIndicators({ ...indicators, dbp: v })}
                />
                <NumField
                  label="3. 空腹血糖（mmol/L）"
                  step={0.1}
                  placeholder="例：5.5"
                  value={indicators.fpg}
                  onChange={(v) => setIndicators({ ...indicators, fpg: v })}
                />
                <NumField
                  label="4. 糖化血红蛋白（%）"
                  step={0.1}
                  placeholder="例：5.5"
                  value={indicators.hba1c}
                  onChange={(v) => setIndicators({ ...indicators, hba1c: v })}
                />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-amber-500 to-yellow-600"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">血脂谱</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 5–8
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
                <NumField
                  label="5. 甘油三酯（mmol/L）"
                  step={0.01}
                  placeholder="例：1.20"
                  value={indicators.tg}
                  onChange={(v) => setIndicators({ ...indicators, tg: v })}
                />
                <NumField
                  label="6. 总胆固醇（mmol/L）"
                  step={0.01}
                  placeholder="例：4.50"
                  value={indicators.tc}
                  onChange={(v) => setIndicators({ ...indicators, tc: v })}
                />
                <NumField
                  label="7. 高密度脂蛋白胆固醇（mmol/L）"
                  step={0.01}
                  placeholder="例：1.20"
                  value={indicators.hdl}
                  onChange={(v) => setIndicators({ ...indicators, hdl: v })}
                />
                <NumField
                  label="8. 低密度脂蛋白胆固醇（mmol/L）"
                  step={0.01}
                  placeholder="例：2.80"
                  value={indicators.ldl}
                  onChange={(v) => setIndicators({ ...indicators, ldl: v })}
                />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-red-500 to-rose-700"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">肝、肾与相关酶学 / 电解质</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 9–18
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
                <NumField
                  label="9. 丙氨酸氨基转移酶（U/L）"
                  placeholder="例：25"
                  value={indicators.alt}
                  onChange={(v) => setIndicators({ ...indicators, alt: v })}
                />
                <NumField
                  label="10. 天门冬氨酸氨基转移酶（U/L）"
                  placeholder="例：28"
                  value={indicators.ast}
                  onChange={(v) => setIndicators({ ...indicators, ast: v })}
                />
                <NumField
                  label="11. γ-谷氨酰转移酶（U/L）"
                  placeholder="例：35"
                  value={indicators.ggt}
                  onChange={(v) => setIndicators({ ...indicators, ggt: v })}
                />
                <NumField
                  label="12. 总胆红素（μmol/L）"
                  step={0.1}
                  placeholder="例：12.0"
                  value={indicators.totalBilirubin}
                  onChange={(v) => setIndicators({ ...indicators, totalBilirubin: v })}
                />
                <NumField
                  label="13. 白蛋白（g/L）"
                  step={0.1}
                  placeholder="例：42.0"
                  value={indicators.albumin}
                  onChange={(v) => setIndicators({ ...indicators, albumin: v })}
                />
                <NumField
                  label="14. 血清肌酐（μmol/L）"
                  step={0.1}
                  placeholder="例：70"
                  value={indicators.creatinine}
                  onChange={(v) => setIndicators({ ...indicators, creatinine: v })}
                />
                <NumField
                  label="15. 尿素氮（mmol/L）"
                  step={0.01}
                  placeholder="例：5.20"
                  value={indicators.bun}
                  onChange={(v) => setIndicators({ ...indicators, bun: v })}
                />
                <NumField
                  label="16. 乳酸脱氢酶（U/L）"
                  placeholder="例：180"
                  value={indicators.ldh}
                  onChange={(v) => setIndicators({ ...indicators, ldh: v })}
                />
                <NumField
                  label="17. 氯离子（mmol/L）"
                  step={0.1}
                  placeholder="例：102.0"
                  value={indicators.chloride}
                  onChange={(v) => setIndicators({ ...indicators, chloride: v })}
                />
                <NumField
                  label="18. 血清铁（μmol/L）"
                  step={0.1}
                  placeholder="例：15.0"
                  value={indicators.serumIron}
                  onChange={(v) => setIndicators({ ...indicators, serumIron: v })}
                />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-5 shadow-sm ring-1 ring-slate-100/80 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200/60 pb-4">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-slate-500 to-cyan-700"
                  aria-hidden
                />
                <h3 className="text-sm font-bold text-gray-900">血常规与尿酸</h3>
                <span className="ml-auto rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/80">
                  题 19–24
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
                <NumField
                  label="19. 红细胞压积（%）"
                  step={0.1}
                  placeholder="例：42.0"
                  value={indicators.hematocrit}
                  onChange={(v) => setIndicators({ ...indicators, hematocrit: v })}
                />
                <NumField
                  label="20. 红细胞计数（×10¹²/L）"
                  step={0.01}
                  placeholder="例：4.50"
                  value={indicators.rbc}
                  onChange={(v) => setIndicators({ ...indicators, rbc: v })}
                />
                <NumField
                  label="21. 红细胞分布宽度（%）"
                  step={0.1}
                  placeholder="例：13.0"
                  value={indicators.rdw}
                  onChange={(v) => setIndicators({ ...indicators, rdw: v })}
                />
                <NumField
                  label="22. 血红蛋白（g/L）"
                  step={0.1}
                  placeholder="例：140"
                  value={indicators.hemoglobin}
                  onChange={(v) => setIndicators({ ...indicators, hemoglobin: v })}
                />
                <NumField
                  label="23. 淋巴细胞百分比（%）"
                  step={0.1}
                  placeholder="例：35.0"
                  value={indicators.lymphocytePct}
                  onChange={(v) => setIndicators({ ...indicators, lymphocytePct: v })}
                />
                <NumField
                  label="24. 尿酸（μmol/L）"
                  step={0.1}
                  placeholder="例：360"
                  value={indicators.uricAcid}
                  onChange={(v) => setIndicators({ ...indicators, uricAcid: v })}
                />
              </div>
            </section>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-gray-100/90 bg-slate-50/40 px-5 py-5 sm:flex-row sm:justify-end sm:gap-4 sm:px-7 sm:py-5">
            <button
              type="button"
              onClick={() => setShowIndicatorsForm(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300/90 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-100/80 transition-colors hover:border-gray-400 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                setIndicatorsCompleted(true);
                persistCompletion({ indicatorsCompleted: true });
                setShowIndicatorsForm(false);
                void pushQuestionnaireRemote();
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition-all hover:from-emerald-600 hover:to-teal-700 hover:shadow-lg hover:shadow-emerald-500/30"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {showImagingForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">影像上传</h2>
            <button type="button" onClick={() => setShowImagingForm(false)} className="text-gray-500 hover:text-gray-700">
              收起
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-6">按病种分类上传；支持图/PDF/.dcm。</p>

          <Tabs defaultValue="liver" className="w-full">
            <TabsList className="flex flex-wrap h-auto gap-1 mb-6">
              <TabsTrigger value="liver">肝病·超声</TabsTrigger>
              <TabsTrigger value="diabetes">糖尿病·眼底</TabsTrigger>
              <TabsTrigger value="stroke">卒中·脑CT</TabsTrigger>
            </TabsList>

            <TabsContent value="liver" className="space-y-4">
              <DiseaseImageUpload
                title="腹部超声（肝病）"
                icon={<Waves className="w-8 h-8 text-emerald-600" />}
                inputId="imaging-liver"
                files={imagingFiles.liver}
                onAdd={(files) => appendImagingFiles('liver', files)}
                onRemove={(i) => removeImagingFile('liver', i)}
                remote={{
                  ...imagingRemote.meta.liver,
                  previewUrl: imagingRemote.previewUrl.liver,
                  loading: imagingRemote.loading.liver,
                  error: imagingRemote.error.liver,
                  onDownload: async () => {
                    const blob = await fetchUserAxisImageBlob('liver');
                    const url = URL.createObjectURL(blob);
                    window.open(url, '_blank', 'noopener,noreferrer');
                    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                  },
                  onDelete: async () => {
                    const ok = window.confirm('确定删除已上传的肝病影像吗？');
                    if (!ok) return;
                    await deleteUserAxisImage('liver');
                    setImagingFiles((s) => ({ ...s, liver: [] }));
                    setImagingRemote((s) => {
                      const prevUrl = s.previewUrl.liver;
                      if (prevUrl) URL.revokeObjectURL(prevUrl);
                      return {
                        ...s,
                        meta: { ...s.meta, liver: { exists: false } },
                        previewUrl: { ...s.previewUrl, liver: null },
                      };
                    });
                    void syncImagingMetaFromServer();
                  },
                }}
              />
            </TabsContent>
            <TabsContent value="diabetes" className="space-y-4">
              <DiseaseImageUpload
                title="眼底（糖尿病）"
                icon={<Eye className="w-8 h-8 text-violet-600" />}
                inputId="imaging-diabetes"
                files={imagingFiles.diabetes}
                onAdd={(files) => appendImagingFiles('diabetes', files)}
                onRemove={(i) => removeImagingFile('diabetes', i)}
                remote={{
                  ...imagingRemote.meta.diabetes,
                  previewUrl: imagingRemote.previewUrl.diabetes,
                  loading: imagingRemote.loading.diabetes,
                  error: imagingRemote.error.diabetes,
                  onDownload: async () => {
                    const blob = await fetchUserAxisImageBlob('diabetes');
                    const url = URL.createObjectURL(blob);
                    window.open(url, '_blank', 'noopener,noreferrer');
                    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                  },
                  onDelete: async () => {
                    const ok = window.confirm('确定删除已上传的糖尿病影像吗？');
                    if (!ok) return;
                    await deleteUserAxisImage('diabetes');
                    setImagingFiles((s) => ({ ...s, diabetes: [] }));
                    setImagingRemote((s) => {
                      const prevUrl = s.previewUrl.diabetes;
                      if (prevUrl) URL.revokeObjectURL(prevUrl);
                      return {
                        ...s,
                        meta: { ...s.meta, diabetes: { exists: false } },
                        previewUrl: { ...s.previewUrl, diabetes: null },
                      };
                    });
                    void syncImagingMetaFromServer();
                  },
                }}
              />
            </TabsContent>
            <TabsContent value="stroke" className="space-y-4">
              <DiseaseImageUpload
                title="脑 CT（卒中）"
                icon={<Brain className="w-8 h-8 text-sky-600" />}
                inputId="imaging-stroke"
                files={imagingFiles.stroke}
                onAdd={(files) => appendImagingFiles('stroke', files)}
                onRemove={(i) => removeImagingFile('stroke', i)}
                remote={{
                  ...imagingRemote.meta.stroke,
                  previewUrl: imagingRemote.previewUrl.stroke,
                  loading: imagingRemote.loading.stroke,
                  error: imagingRemote.error.stroke,
                  onDownload: async () => {
                    const blob = await fetchUserAxisImageBlob('stroke');
                    const url = URL.createObjectURL(blob);
                    window.open(url, '_blank', 'noopener,noreferrer');
                    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                  },
                  onDelete: async () => {
                    const ok = window.confirm('确定删除已上传的卒中影像吗？');
                    if (!ok) return;
                    await deleteUserAxisImage('stroke');
                    setImagingFiles((s) => ({ ...s, stroke: [] }));
                    setImagingRemote((s) => {
                      const prevUrl = s.previewUrl.stroke;
                      if (prevUrl) URL.revokeObjectURL(prevUrl);
                      return {
                        ...s,
                        meta: { ...s.meta, stroke: { exists: false } },
                        previewUrl: { ...s.previewUrl, stroke: null },
                      };
                    });
                    void syncImagingMetaFromServer();
                  },
                }}
              />
            </TabsContent>
          </Tabs>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-900">支持格式</p>
                <p className="text-xs text-blue-800 leading-relaxed">
                  常见图片（JPG、PNG）、PDF，以及 DICOM 影像（.dcm）
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-900">文件大小</p>
                <p className="text-xs text-blue-800 leading-relaxed">每个文件不超过 50MB</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4 mt-8 pt-6 border-t">
            <button
              type="button"
              onClick={() => setShowImagingForm(false)}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  await syncImagingMetaFromServer();
                  setShowImagingForm(false);
                })();
              }}
              className="px-6 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg hover:from-emerald-600 hover:to-teal-700 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {showDerivedPanel && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">衍生指标</h2>
            <button type="button" onClick={() => setShowDerivedPanel(false)} className="text-gray-500 hover:text-gray-700">
              收起
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-6">据已填项自动算，缺项为 —。</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-3 font-medium text-gray-700">项</th>
                  <th className="p-3 font-medium text-gray-700">说明</th>
                  <th className="p-3 font-medium text-gray-700">值</th>
                  <th className="p-3 font-medium text-gray-700">单位</th>
                  <th className="p-3 font-medium text-gray-700">注</th>
                </tr>
              </thead>
              <tbody>
                {derivedRows.map((row) => (
                  <tr key={row.key} className="border-t border-gray-100">
                    <td className="p-3 font-medium text-gray-900">{row.name}</td>
                    <td className="p-3 text-gray-600 text-xs max-w-xs">{row.formula}</td>
                    <td className="p-3 font-mono text-emerald-700 font-semibold">{row.value ?? '—'}</td>
                    <td className="p-3 text-gray-600">{row.unit}</td>
                    <td className="p-3 text-gray-500 text-xs">{row.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200/90 bg-white p-5 shadow-sm ring-1 ring-gray-100/90 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">下一步</p>
            <h3 className="mt-1 text-lg font-bold tracking-tight text-gray-900 sm:text-xl">进入风险评估分析</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              {canAnalyze ? '数据已就绪，可发起模型分析；也可继续完善各模块后再次分析。' : '请先在上方模块中填写并保存至少一项数据。'}
            </p>
          </div>
          <button
            type="button"
            disabled={!canAnalyze || cloudSyncing}
            onClick={analyzeNow}
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-sm font-semibold transition-all',
              canAnalyze && !cloudSyncing
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-600 hover:to-teal-700 hover:shadow-xl'
                : 'cursor-not-allowed bg-gray-100 text-gray-400 ring-1 ring-gray-200/80',
            )}
          >
            <Sparkles className="h-5 w-5 shrink-0" aria-hidden />
            <span>分析</span>
            <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

const IMAGING_ACCEPT =
  'image/jpeg,image/png,image/webp,image/bmp,application/pdf,.dcm,.dicom,application/dicom';

function DiseaseImageUpload({
  title,
  description,
  icon,
  inputId,
  files,
  onAdd,
  onRemove,
  remote,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  inputId: string;
  files: File[];
  onAdd: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  remote?: {
    exists: boolean;
    filename?: string;
    mimeType?: string;
    previewUrl?: string | null;
    loading?: boolean;
    error?: string | null;
    onDownload?: () => void;
    onDelete?: () => void;
  };
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
        <div className="flex-shrink-0 p-2 bg-white rounded-lg border border-gray-100 shadow-sm">{icon}</div>
        <div>
          <p className="font-semibold text-gray-900">{title}</p>
          {description ? <p className="text-sm text-gray-600 mt-1">{description}</p> : null}
        </div>
      </div>

      <label
        htmlFor={inputId}
        className="block cursor-pointer border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors"
      >
        <ImageIcon className="w-12 h-12 text-gray-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-gray-900 mb-3">点击上传（将覆盖保存 1 份）</p>
        <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-medium pointer-events-none">
          <Upload className="w-4 h-4" />
          选文件
        </span>
        <input
          id={inputId}
          type="file"
          multiple
          accept={IMAGING_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            onAdd(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {remote?.loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在上传/刷新…
        </div>
      ) : null}
      {remote?.error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          上传失败：{remote.error}
        </div>
      ) : null}

      {remote?.exists ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-900">已上传</p>
          <p className="mt-1 text-xs text-gray-600 break-all">
            {remote.filename}{remote.mimeType ? `（${remote.mimeType}）` : ''}
          </p>
          {remote.previewUrl ? (
            <img
              src={remote.previewUrl}
              alt={remote.filename || title}
              className="mt-3 max-h-64 w-full rounded-lg border border-gray-100 object-contain bg-gray-50"
              loading="lazy"
            />
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {remote.onDownload ? (
              <button
                type="button"
                onClick={remote.onDownload}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                下载/打开
              </button>
            ) : null}
            {remote.onDelete ? (
              <button
                type="button"
                onClick={remote.onDelete}
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                删除
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {files.length > 0 && (
        <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white text-sm">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}-${f.size}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="truncate text-gray-800" title={f.name}>
                {f.name}
              </span>
              <span className="text-gray-500 shrink-0">{(f.size / 1024).toFixed(1)} KB</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="text-xs text-red-600 hover:text-red-700 shrink-0"
              >
                删
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModuleCard({
  icon,
  iconClass,
  title,
  desc,
  done,
  onOpen,
  isDerived,
}: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  desc: string;
  done: boolean;
  onOpen: () => void;
  isDerived?: boolean;
}) {
  return (
    <div className="group flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-100/90 bg-white p-5 shadow-sm ring-1 ring-gray-100/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/5 hover:ring-emerald-100/70 sm:p-6">
      <div className={cn('mb-4 h-1 w-14 shrink-0 rounded-full bg-gradient-to-r', iconClass)} aria-hidden />
      <div className="mb-4 flex shrink-0 items-start justify-between gap-2">
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br shadow-md ring-2 ring-white/80',
            iconClass,
          )}
        >
          {icon}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {done ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              已保存
            </span>
          ) : null}
          {isDerived ? (
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800 ring-1 ring-teal-200/80">
              自动
            </span>
          ) : null}
        </div>
      </div>
      <h3 className="mb-2 shrink-0 text-lg font-bold tracking-tight text-gray-900">{title}</h3>
      <p className="min-h-0 flex-1 text-sm leading-relaxed text-gray-600">{desc}</p>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'mt-5 flex w-full shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all',
          done && !isDerived
            ? 'border border-gray-200/90 bg-gray-50 text-gray-800 hover:bg-gray-100 hover:ring-1 hover:ring-gray-200/80'
            : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/15 hover:from-emerald-600 hover:to-teal-700 hover:shadow-lg',
        )}
      >
        {done && !isDerived ? (
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
        ) : isDerived ? (
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span>{done && !isDerived ? '查看' : isDerived ? '结果' : '填写'}</span>
      </button>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  hint,
  step,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  step?: number;
  placeholder?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200/60 bg-white p-4 shadow-sm ring-1 ring-slate-50">
      <Label className="text-sm font-medium leading-relaxed text-gray-800">{label}</Label>
      <Input
        type="number"
        step={step ?? 1}
        placeholder={placeholder ?? ''}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-lg border-slate-200/90 shadow-sm focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/25"
      />
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}
