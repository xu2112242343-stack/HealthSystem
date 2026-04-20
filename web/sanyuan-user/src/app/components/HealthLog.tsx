import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, CalendarDays, Clock, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import {
  fetchUserHealthHistoryDetail,
  fetchUserHealthHistoryList,
  type HealthHistoryDetailResponse,
  type HealthHistorySnapshotSummary,
} from '@/lib/api/healthHistory';

function riskBadgeStyle(level: string) {
  if (level === 'high' || level === '高风险') return 'border-red-200 bg-red-50 text-red-700';
  if (level === 'medium' || level === '中风险') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

export function HealthLog() {
  const [snapshots, setSnapshots] = useState<HealthHistorySnapshotSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<HealthHistoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setErrorMsg(null);

    void (async () => {
      try {
        const res = await fetchUserHealthHistoryList();
        if (!mounted) return;
        setSnapshots(res.snapshots || []);
        const first = res.snapshots?.[0]?.id ?? null;
        setSelectedId(first);
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setErrorMsg('加载随访历史失败，请稍后重试。');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (selectedId == null) return;
    let mounted = true;
    setDetailLoading(true);
    void (async () => {
      try {
        const res = await fetchUserHealthHistoryDetail(selectedId);
        if (!mounted) return;
        setDetail(res);
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setDetail(null);
      } finally {
        if (mounted) setDetailLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  const selected = useMemo(() => {
    if (selectedId == null) return null;
    return snapshots.find((s) => s.id === selectedId) ?? null;
  }, [snapshots, selectedId]);

  const chartData = useMemo(() => {
    if (!detail) return [];
    const { x, series } = detail.indicatorTrend;
    return x.map((dateStr, i) => ({
      date: dateStr,
      fpg: series.fpg[i] ?? null,
      hba1c: series.hba1c[i] ?? null,
      tg: series.tg[i] ?? null,
    }));
  }, [detail]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">随访历史</h2>
          <p className="mt-1 text-sm text-gray-600">历史快照 + 单次详情 + 指标趋势</p>
        </div>

        {selected?.isOverdue ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4" />
            已过期：建议尽快复评
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <Clock className="h-4 w-4" />
            {selected?.remainingDays != null ? `剩余 ${selected.remainingDays} 天` : '未设复评计划'}
          </div>
        )}
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
      ) : snapshots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-16 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden />
          <p className="text-sm font-medium text-gray-700">暂无随访快照</p>
          <p className="mt-2 text-xs text-gray-500">提交一次问卷后即可生成历史记录。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* 列表 */}
          <div className="md:col-span-1">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
              <CalendarDays className="h-4 w-4 text-teal-600" />
              历史列表
            </h3>
            <div className="space-y-3">
              {snapshots.map((s) => (
                <motion.button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  whileTap={{ scale: 0.99 }}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                    selectedId === s.id
                      ? 'border-teal-200 bg-teal-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900">{s.snapshotAt.slice(0, 10)}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${riskBadgeStyle(s.maxRisk.level)}`}>
                          {s.maxRisk.label}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-gray-500">
                      {s.remainingDays != null ? `${s.remainingDays}d` : '—'}
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>

          {/* 详情 */}
          <div className="md:col-span-2">
            {detailLoading ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-10 text-center text-sm text-gray-600">
                加载详情...
              </div>
            ) : !detail ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 px-6 py-10 text-center text-sm text-gray-600">
                暂无详情数据
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">单次详情</h3>
                      <p className="mt-1 text-sm text-gray-600">{detail.snapshotAt.slice(0, 19).replace('T', ' ')}</p>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      <TrendingUp className="h-4 w-4 text-teal-600" />
                      最大风险：{detail.followUpPlan.scheduleLabel}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">肝病概率</div>
                      <div className="mt-1 text-lg font-semibold text-gray-900">{Math.round(detail.probabilities.liver * 100)}%</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">糖尿病概率</div>
                      <div className="mt-1 text-lg font-semibold text-gray-900">{Math.round(detail.probabilities.diabetes * 100)}%</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">脑卒中概率</div>
                      <div className="mt-1 text-lg font-semibold text-gray-900">{Math.round(detail.probabilities.stroke * 100)}%</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-900">随访计划与提醒</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">建议复评日期</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900">{detail.followUpPlan.nextReviewDate.slice(0, 10)}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">剩余天数</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900">
                        {detail.followUpPlan.remainingDays >= 0 ? `${detail.followUpPlan.remainingDays} 天` : '已过期'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">复评间隔</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900">{detail.followUpPlan.intervalDays} 天</div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-sm font-semibold text-gray-900">复评前你可以优先关注</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                      {detail.reminderSuggestions.slice(0, 5).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-900">医生建议</h3>
                  {detail.doctorAdvice ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{detail.doctorAdvice}</p>
                  ) : (
                    <p className="mt-2 text-sm text-gray-500">医生暂未填写建议，请先按当前计划进行复评与自我管理。</p>
                  )}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-900">指标趋势</h3>
                  <p className="mt-1 text-sm text-gray-600">用于观察关键指标随随访进展的变化趋势</p>
                  <div className="mt-4" style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tickFormatter={(t) => String(t).slice(5)} />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="fpg" name="fpg" stroke="#14b8a6" strokeWidth={2} dot={false} />
                        <Line
                          type="monotone"
                          dataKey="hba1c"
                          name="hba1c"
                          stroke="#0ea5e9"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line type="monotone" dataKey="tg" name="tg" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
