import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Database, Plus, Edit, Trash2, Search, MapPin, Phone, Clock } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import {
  createAdminHospital,
  deleteAdminHospital,
  fetchAdminHospitals,
  updateAdminHospital,
  type AdminHospitalRow,
} from '@/lib/api/adminHospitals';

interface HospitalInfoPageProps {
  onBack: () => void;
}

interface HospitalListItem {
  id: number;
  name: string;
  level: string;
  address: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  department: string;
  departments: string[];
  specialties: string[];
  workingHours: string;
}

export function HospitalInfoPage({ onBack }: HospitalInfoPageProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<HospitalListItem | null>(null);
  const [hospitals, setHospitals] = useState<HospitalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);

  const [form, setForm] = useState({
    name: '',
    level: '',
    address: '',
    phone: '',
    latitude: '',
    longitude: '',
    department: '',
    workingHours: '',
    departments: '',
    specialties: '',
  });

  const resetForm = () => {
    setForm({
      name: '',
      level: '',
      address: '',
      phone: '',
      latitude: '',
      longitude: '',
      department: '',
      workingHours: '',
      departments: '',
      specialties: '',
    });
  };

  const parseNum = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const loadList = async (nextPage = page, nextQuery = query) => {
    setLoading(true);
    setApiError(null);
    try {
      const res = await fetchAdminHospitals({ page: nextPage, pageSize, keyword: nextQuery });
      setHospitals(
        (res.items || []).map((r: AdminHospitalRow) => ({
          id: r.id,
          name: r.name,
          level: r.level || '',
          address: r.address,
          phone: r.phone,
          latitude: r.latitude ?? null,
          longitude: r.longitude ?? null,
          department: r.department || '',
          departments: (r.departments || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          specialties: (r.specialties || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          workingHours: r.workingHours || '',
        })),
      );
      setTotal(res.total ?? 0);
      setPage(res.page ?? nextPage);
    } catch (e) {
      setHospitals([]);
      setTotal(0);
      setApiError(e instanceof Error ? e.message : '加载医院列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadList(1, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setShowAddForm(true);
  };

  const openEdit = (h: HospitalListItem) => {
    setEditing(h);
    setForm({
      name: h.name,
      level: h.level || '',
      address: h.address,
      phone: h.phone,
      latitude: h.latitude == null ? '' : String(h.latitude),
      longitude: h.longitude == null ? '' : String(h.longitude),
      department: h.department || '',
      workingHours: h.workingHours || '',
      departments: h.departments.join(','),
      specialties: h.specialties.join(','),
    });
    setShowAddForm(true);
  };

  const onCloseForm = () => {
    setShowAddForm(false);
    setEditing(null);
    resetForm();
  };

  const onSave = async () => {
    setApiError(null);
    if (!form.name.trim() || !form.address.trim() || !form.phone.trim()) {
      setApiError('请填写医院名称、地址、联系电话。');
      return;
    }
    try {
      const body = {
        name: form.name.trim(),
        level: form.level.trim() || undefined,
        address: form.address.trim(),
        phone: form.phone.trim(),
        latitude: parseNum(form.latitude),
        longitude: parseNum(form.longitude),
        department: form.department.trim() || undefined,
        departments: form.departments.trim() || undefined,
        specialties: form.specialties.trim() || undefined,
        working_hours: form.workingHours.trim() || undefined,
        is_active: true,
      };
      if (editing) {
        await updateAdminHospital(editing.id, body);
      } else {
        await createAdminHospital(body);
      }
      onCloseForm();
      await loadList(1, query);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : '保存失败');
    }
  };

  const onDelete = async (h: HospitalListItem) => {
    const ok = window.confirm(`确定删除医院「${h.name}」吗？此操作不可恢复。`);
    if (!ok) return;
    try {
      await deleteAdminHospital(h.id);
      await loadList(page, query);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const emptyText = useMemo(() => (loading ? '加载中…' : '暂无医院记录。'), [loading]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">返回医疗数据库管理</span>
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Database className="w-7 h-7 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">医院信息管理</h1>
              <p className="text-sm text-gray-600 mt-1">管理和维护医院信息数据库</p>
            </div>
          </div>
          <Button
            onClick={() => (showAddForm ? onCloseForm() : openCreate())}
            className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            {showAddForm ? '关闭表单' : '添加医院'}
          </Button>
        </div>
      </div>

      {/* Add Hospital Form */}
      {showAddForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{editing ? '编辑医院' : '添加新医院'}</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="hospital-name">医院名称 *</Label>
              <Input id="hospital-name" placeholder="请输入医院名称" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="level">医院等级 *</Label>
              <Input id="level" placeholder="如：三甲、二甲等" value={form.level} onChange={(e) => setForm((s) => ({ ...s, level: e.target.value }))} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address">医院地址 *</Label>
              <Input id="address" placeholder="请输入详细地址" value={form.address} onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">联系电话 *</Label>
              <Input id="phone" placeholder="请输入联系电话" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="working-hours">营业时间</Label>
              <Input id="working-hours" placeholder="如：8:00-18:00" value={form.workingHours} onChange={(e) => setForm((s) => ({ ...s, workingHours: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lat">纬度</Label>
              <Input id="lat" placeholder="如：23.1291" value={form.latitude} onChange={(e) => setForm((s) => ({ ...s, latitude: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lng">经度</Label>
              <Input id="lng" placeholder="如：113.2644" value={form.longitude} onChange={(e) => setForm((s) => ({ ...s, longitude: e.target.value }))} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="dept">推荐科室</Label>
              <Input id="dept" placeholder="展示用，如：内分泌科" value={form.department} onChange={(e) => setForm((s) => ({ ...s, department: e.target.value }))} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="departments">科室列表</Label>
              <Input id="departments" placeholder="请输入科室，用逗号分隔" value={form.departments} onChange={(e) => setForm((s) => ({ ...s, departments: e.target.value }))} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="specialties">特色专科</Label>
              <Input id="specialties" placeholder="请输入特色专科，用逗号分隔" value={form.specialties} onChange={(e) => setForm((s) => ({ ...s, specialties: e.target.value }))} />
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Button onClick={() => void onSave()} className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700">
              保存
            </Button>
            <Button variant="outline" onClick={onCloseForm}>
              取消
            </Button>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="搜索医院名称、地址或科室..." className="pl-10" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => void loadList(1, query)}>搜索</Button>
        </div>
      </div>

      {/* Hospital List */}
      <div className="space-y-4">
        {apiError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            {apiError}
          </div>
        ) : hospitals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-12 text-center text-sm text-gray-500">
            {emptyText}
          </div>
        ) : (
          hospitals.map((hospital) => (
          <div key={hospital.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">{hospital.name}</h3>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    {hospital.level}
                  </Badge>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-600">{hospital.address}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-600">{hospital.phone}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-600">{hospital.workingHours}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 ml-4">
                <Button variant="outline" size="sm" onClick={() => openEdit(hospital)}>
                  <Edit className="w-4 h-4" />
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void onDelete(hospital)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">科室列表</div>
                <div className="flex flex-wrap gap-1">
                  {hospital.departments.map((dept, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      {dept}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">特色专科</div>
                <div className="flex flex-wrap gap-1">
                  {hospital.specialties.map((specialty, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs bg-teal-50 text-teal-700 border-teal-200">
                      {specialty}
                    </Badge>
                  ))}
                </div>
              </div>
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
            <Button variant="outline" disabled={page <= 1 || loading} onClick={() => void loadList(page - 1, query)}>
              上一页
            </Button>
            <Button
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
