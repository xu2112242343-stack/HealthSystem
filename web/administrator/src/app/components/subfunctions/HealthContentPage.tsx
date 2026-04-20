import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Database, Plus, Edit, Trash2, Search } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Textarea } from '@/app/components/ui/textarea';
import { Badge } from '@/app/components/ui/badge';
import { Checkbox } from '@/app/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import {
  createAdminHealthArticle,
  deleteAdminHealthArticle,
  fetchAdminHealthArticles,
  updateAdminHealthArticle,
  type AdminHealthArticleRow,
} from '@/lib/api/adminHealthArticles';

interface HealthContentPageProps {
  onBack: () => void;
}

const DISEASE_OPTIONS = ['非酒精性脂肪肝', '2型糖尿病', '脑卒中'] as const;

const CONTENT_TYPE_OPTIONS = [
  '认知类（疾病介绍）',
  '风险解读类（风险原因分析）',
  '干预类（改善/治疗方法）',
  '饮食/运动类（具体行动建议）',
  '关联疾病类（疾病关系说明）',
] as const;

const RISK_LEVEL_OPTIONS = ['低风险', '中风险', '高风险'] as const;

function normalizeDiseaseLabel(raw: string): (typeof DISEASE_OPTIONS)[number] | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const k = s.replace(/\s+/g, '').toLowerCase();

  // Liver
  if (
    k === 'mafld' ||
    k === 'nafld' ||
    k.includes('代谢相关脂肪性肝病') ||
    k.includes('脂肪性肝病') ||
    k.includes('脂肪肝') ||
    k.includes('非酒精性脂肪肝')
  ) {
    return '非酒精性脂肪肝';
  }

  // Diabetes
  if (
    k === 't2dm' ||
    k.includes('2型糖尿病') ||
    k.includes('2型') && k.includes('糖尿病') ||
    k.includes('二型糖尿病') ||
    k.includes('ii型糖尿病') ||
    k.includes('ⅱ型糖尿病') ||
    k.includes('Ⅱ型糖尿病') ||
    k.includes('糖尿病')
  ) {
    return '2型糖尿病';
  }

  // Stroke
  if (k === 'cva' || k.includes('脑卒中') || k.includes('卒中') || k.includes('脑梗') || k.includes('脑出血')) {
    return '脑卒中';
  }

  return null;
}

function splitAndNormalizeDiseases(v: string): (typeof DISEASE_OPTIONS)[number][] {
  const out: (typeof DISEASE_OPTIONS)[number][] = [];
  for (const token of String(v || '')
    .split(/[,，、;；|/]+/g)
    .map((x) => x.trim())
    .filter(Boolean)) {
    const n = normalizeDiseaseLabel(token);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

const DISEASE_STAT_CARD_STYLES = [
  {
    wrap: 'from-blue-50 to-cyan-50',
    border: 'border-blue-200',
    title: 'text-blue-600',
    value: 'text-blue-900',
    sub: 'text-blue-700/80',
  },
  {
    wrap: 'from-purple-50 to-pink-50',
    border: 'border-purple-200',
    title: 'text-purple-600',
    value: 'text-purple-900',
    sub: 'text-purple-700/80',
  },
  {
    wrap: 'from-green-50 to-emerald-50',
    border: 'border-green-200',
    title: 'text-green-600',
    value: 'text-green-900',
    sub: 'text-emerald-700/80',
  },
] as const;

interface HealthContentEntry {
  id: number;
  title: string;
  summary: string;
  content: string;
  disease: string;
  type: string;
  tags: string;
  risk_level: string;
  source: string;
  show_in_health_guide: boolean;
}

const emptyForm = () => ({
  idStr: '',
  title: '',
  summary: '',
  content: '',
  diseaseSel: [] as string[],
  type: '' as string,
  riskSel: [] as string[],
  tags: '',
  source: '',
  showInGuide: true,
});

export function HealthContentPage({ onBack }: HealthContentPageProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const [entries, setEntries] = useState<HealthContentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);

  const nextSuggestedId = useMemo(() => {
    const max = entries.reduce((m, e) => Math.max(m, e.id), 100);
    return max + 1;
  }, [entries]);

  const loadList = async (nextPage = page, nextQuery = query) => {
    setLoading(true);
    setApiError(null);
    try {
      const res = await fetchAdminHealthArticles({ page: nextPage, pageSize, keyword: nextQuery });
      setEntries(
        (res.items || []).map((r: AdminHealthArticleRow) => ({
          id: r.id,
          title: r.title,
          summary: r.summary,
          content: r.content,
          disease: r.disease,
          type: r.type,
          tags: r.tags ?? '',
          risk_level: r.risk_level ?? '',
          source: r.source ?? '',
          show_in_health_guide: r.show_in_health_guide !== false,
        })),
      );
      setTotal(res.total ?? 0);
      setPage(res.page ?? nextPage);
    } catch (e) {
      setEntries([]);
      setTotal(0);
      setApiError(e instanceof Error ? e.message : '加载健康内容失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadList(1, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const diseaseContentCounts = useMemo(() => {
    const counts: Record<(typeof DISEASE_OPTIONS)[number], number> = {
      非酒精性脂肪肝: 0,
      '2型糖尿病': 0,
      脑卒中: 0,
    };
    for (const e of entries) {
      const labels = splitAndNormalizeDiseases(e.disease);
      for (const d of labels) counts[d] += 1;
    }
    return counts;
  }, [entries]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...emptyForm(), idStr: String(nextSuggestedId), showInGuide: true });
    setFormError(null);
    setShowAddForm(true);
  };

  const openEdit = (e: HealthContentEntry) => {
    setEditingId(e.id);
    setForm({
      idStr: String(e.id),
      title: e.title,
      summary: e.summary,
      content: e.content,
      diseaseSel: e.disease
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((t) => normalizeDiseaseLabel(t) || t)
        .filter((d) => DISEASE_OPTIONS.includes(d as (typeof DISEASE_OPTIONS)[number])),
      type: e.type,
      riskSel: e.risk_level
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((r) => RISK_LEVEL_OPTIONS.includes(r as (typeof RISK_LEVEL_OPTIONS)[number])),
      tags: e.tags,
      source: e.source,
      showInGuide: e.show_in_health_guide !== false,
    });
    setFormError(null);
    setShowAddForm(true);
  };

  const toggleDisease = (name: string) => {
    setForm((f) => ({
      ...f,
      diseaseSel: f.diseaseSel.includes(name)
        ? f.diseaseSel.filter((x) => x !== name)
        : [...f.diseaseSel, name],
    }));
  };

  const toggleRisk = (name: string) => {
    setForm((f) => ({
      ...f,
      riskSel: f.riskSel.includes(name) ? f.riskSel.filter((x) => x !== name) : [...f.riskSel, name],
    }));
  };

  const validateAndBuild = (): HealthContentEntry | null => {
    const idNum = parseInt(form.idStr.trim(), 10);
    if (!Number.isFinite(idNum) || idNum < 101) {
      setFormError('编号须为从 101 起的整数。');
      return null;
    }
    const dup = entries.some((e) => e.id === idNum && e.id !== editingId);
    if (dup) {
      setFormError('编号已存在，请使用唯一编号。');
      return null;
    }
    if (!form.title.trim()) {
      setFormError('请填写标题。');
      return null;
    }
    if (!form.summary.trim()) {
      setFormError('请填写摘要。');
      return null;
    }
    if (!form.content.trim()) {
      setFormError('请填写正文。');
      return null;
    }
    if (form.diseaseSel.length === 0) {
      setFormError('请至少选择一项疾病分类。');
      return null;
    }
    if (!form.type || !CONTENT_TYPE_OPTIONS.includes(form.type as (typeof CONTENT_TYPE_OPTIONS)[number])) {
      setFormError('请从五类内容类型中选择一项。');
      return null;
    }
    if (!form.tags.trim()) {
      setFormError('请填写标签（多个用英文逗号分隔）。');
      return null;
    }
    if (form.riskSel.length === 0) {
      setFormError('请至少选择一项风险等级。');
      return null;
    }
    if (!form.source.trim()) {
      setFormError('请填写来源链接。');
      return null;
    }

    setFormError(null);
    return {
      id: idNum,
      title: form.title.trim(),
      summary: form.summary.trim(),
      content: form.content.trim(),
      disease: form.diseaseSel.join(','),
      type: form.type,
      tags: form.tags.trim(),
      risk_level: form.riskSel.join(','),
      source: form.source.trim(),
      show_in_health_guide: form.showInGuide,
    };
  };

  const handleSave = async () => {
    const row = validateAndBuild();
    if (!row) return;
    try {
      if (editingId !== null) {
        await updateAdminHealthArticle(editingId, {
          id: row.id,
          title: row.title,
          summary: row.summary,
          content: row.content,
          disease: row.disease,
          type: row.type,
          tags: row.tags,
          risk_level: row.risk_level,
          source: row.source,
          show_in_health_guide: row.show_in_health_guide,
        });
      } else {
        await createAdminHealthArticle({
          id: row.id,
          title: row.title,
          summary: row.summary,
          content: row.content,
          disease: row.disease,
          type: row.type,
          tags: row.tags,
          risk_level: row.risk_level,
          source: row.source,
          show_in_health_guide: row.show_in_health_guide,
        });
      }
      setShowAddForm(false);
      setEditingId(null);
      setForm(emptyForm());
      await loadList(1, query);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    }
  };

  const handleCancelForm = () => {
    setShowAddForm(false);
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const handleDelete = async (id: number) => {
    const ok = window.confirm(`确定删除文章 #${id} 吗？此操作不可恢复。`);
    if (!ok) return;
    try {
      await deleteAdminHealthArticle(id);
      if (editingId === id) handleCancelForm();
      await loadList(page, query);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : '删除失败');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">返回医疗数据库管理</span>
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Database className="w-7 h-7 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">健康内容</h1>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => (showAddForm ? handleCancelForm() : openAdd())}
            className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 shrink-0"
          >
            <Plus className="w-4 h-4 mr-2" />
            {showAddForm ? '关闭表单' : '添加健康内容'}
          </Button>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {editingId !== null ? '编辑健康内容' : '添加健康内容'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            请完整填写以下字段；疾病分类与风险等级可多选，保存后以逗号拼接存储。
          </p>

          {formError && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {formError}
            </div>
          )}

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="hc-id">编号</Label>
                <Input
                  id="hc-id"
                  value={form.idStr}
                  onChange={(e) => setForm((f) => ({ ...f, idStr: e.target.value }))}
                  placeholder="如 101，不可重复"
                />
                <p className="text-xs text-gray-500">唯一编号，从 101 起，不可与其他条目重复。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="hc-title">标题</Label>
                <Input
                  id="hc-title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="文章标题，简洁清晰"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hc-summary">摘要</Label>
              <Textarea
                id="hc-summary"
                value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                placeholder="2–3 句话概括核心内容，用于推荐展示"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hc-content">正文</Label>
              <Textarea
                id="hc-content"
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="分段撰写"
                rows={10}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-3">
              <Label>疾病分类</Label>
              <p className="text-xs text-gray-500 -mt-1">可多选，保存后为英文逗号分隔。</p>
              <div className="flex flex-col gap-2">
                {DISEASE_OPTIONS.map((d) => (
                  <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.diseaseSel.includes(d)} onCheckedChange={() => toggleDisease(d)} />
                    <span>{d}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>内容类型</Label>
              <p className="text-xs text-gray-500">仅从以下五类中选择一项，禁止自定义。</p>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择内容类型" />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hc-tags">标签</Label>
              <Input
                id="hc-tags"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="多个标签用英文逗号分隔，如：饮食,减肥,降脂"
              />
              <p className="text-xs text-gray-500">可由 AI 总结；用于推荐匹配。</p>
            </div>

            <div className="space-y-3">
              <Label>风险等级</Label>
              <p className="text-xs text-gray-500 -mt-1">可多选，保存后为英文逗号分隔。</p>
              <div className="flex flex-col gap-2">
                {RISK_LEVEL_OPTIONS.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.riskSel.includes(r)} onCheckedChange={() => toggleRisk(r)} />
                    <span>{r}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hc-source">来源链接</Label>
              <Input
                id="hc-source"
                type="url"
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                placeholder="原始文章来源 URL"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.showInGuide}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, showInGuide: v === true }))}
                />
                <span>在用户端「健康生活指南」中展示</span>
              </label>
              <p className="text-xs text-gray-500">
                取消勾选则仅参与管理端统计与健康内容分布，用户端干预页不列出此文。
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={handleSave}
              className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700"
            >
              保存
            </Button>
            <Button type="button" variant="outline" onClick={handleCancelForm}>
              取消
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {DISEASE_OPTIONS.map((disease, i) => {
          const cfg = DISEASE_STAT_CARD_STYLES[i];
          return (
            <div
              key={disease}
              className={`bg-gradient-to-br ${cfg.wrap} rounded-lg p-4 border ${cfg.border} text-center sm:text-left`}
            >
              <div className={`text-sm ${cfg.title} mb-1`}>{disease}</div>
              <div className={`text-2xl font-bold ${cfg.value} tabular-nums`}>
                {diseaseContentCounts[disease]}
              </div>
              <div className={`text-xs ${cfg.sub} mt-1`}>关联该疾病的健康内容篇数</div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="搜索标题、编号或标签…"
              className="pl-10"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            type="button"
            onClick={() => void loadList(1, query)}
          >
            搜索
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {apiError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            {apiError}
          </div>
        ) : loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
            正在加载…
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-12 text-center text-sm text-gray-500">
            暂无健康内容条目。可点击「添加健康内容」新建，或接入内容库接口后由后端下发。
          </div>
        ) : (
          entries.map((item) => (
          <div
            key={item.id}
            className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Badge variant="outline" className="font-mono">
                    #{item.id}
                  </Badge>
                  {!item.show_in_health_guide ? (
                    <Badge variant="secondary" className="text-xs">
                      仅统计
                    </Badge>
                  ) : null}
                  <h3 className="text-lg font-semibold text-gray-900">{item.title}</h3>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{item.summary}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {item.disease.split(',').map((d) => (
                    <Badge key={d} variant="secondary" className="text-xs">
                      {d.trim()}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="text-xs bg-teal-50 text-teal-800 border-teal-200">
                    {item.type}
                  </Badge>
                  {item.risk_level.split(',').map((r) => (
                    <Badge key={r} variant="outline" className="text-xs">
                      {r.trim()}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">标签：{item.tags}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" type="button" onClick={() => openEdit(item)}>
                  <Edit className="w-4 h-4" />
                </Button>
                <Button variant="destructive" size="sm" type="button" onClick={() => handleDelete(item.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="text-xs text-gray-500 space-y-1 border-t border-gray-100 pt-4">
              <p className="truncate">
                <span className="font-medium text-gray-700">来源链接：</span>
                {item.source}
              </p>
            </div>
          </div>
        ))
        )}
      </div>

      {total > pageSize ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-gray-500">
            共 {total} 条 · 第 {page} 页
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => void loadList(page - 1, query)}
            >
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={page * pageSize >= total || loading}
              onClick={() => void loadList(page + 1, query)}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
