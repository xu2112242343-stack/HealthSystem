import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Search,
  Edit,
  UserCircle,
  Phone,
  Mail,
  Building,
  Award,
  Calendar,
  Lock,
  Unlock,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';

interface DoctorInfoQueryPageProps {
  onBack: () => void;
}

type AccountStatus = 'active' | 'disabled' | 'suspended';

interface DoctorRow {
  id: string;
  name: string;
  account: string;
  specialty: string;
  title: string;
  hospital: string;
  phone: string;
  email: string;
  certificationStatus: string;
  yearsOfExperience: string;
  education: string;
  registrationDate: string;
  recordStatus: string;
  accountStatus: AccountStatus;
  lastLogin: string;
}

const initialDoctors: DoctorRow[] = [];

function getAccountStatusInfo(status: AccountStatus) {
  switch (status) {
    case 'active':
      return { label: '已启用', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 };
    case 'disabled':
      return { label: '已禁用', color: 'bg-red-100 text-red-700', icon: Lock };
    case 'suspended':
      return { label: '暂停使用', color: 'bg-amber-100 text-amber-700', icon: Clock };
    default:
      return { label: '未知', color: 'bg-gray-100 text-gray-700', icon: AlertTriangle };
  }
}

export function DoctorInfoQueryPage({ onBack }: DoctorInfoQueryPageProps) {
  const [searchType, setSearchType] = useState('name');
  const [searchValue, setSearchValue] = useState('');
  const [doctors, setDoctors] = useState<DoctorRow[]>(initialDoctors);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [showConfirm, setShowConfirm] = useState(false);
  const [actionType, setActionType] = useState<'enable' | 'disable' | null>(null);
  const [statusReason, setStatusReason] = useState('');

  const selectedDoctor = useMemo(
    () => (selectedId ? doctors.find((d) => d.id === selectedId) ?? null : null),
    [doctors, selectedId],
  );

  const handleSearch = () => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return;
    const found = doctors.find((d) => {
      switch (searchType) {
        case 'name':
          return d.name.toLowerCase().includes(q);
        case 'account':
          return d.account.toLowerCase().includes(q);
        case 'phone':
          return d.phone.includes(searchValue.trim());
        case 'hospital':
          return d.hospital.toLowerCase().includes(q);
        default:
          return false;
      }
    });
    if (found) {
      setSelectedId(found.id);
      setIsEditing(false);
      setShowConfirm(false);
      setActionType(null);
      setStatusReason('');
    }
  };

  const handleStatusActionClick = (type: 'enable' | 'disable') => {
    setActionType(type);
    setShowConfirm(true);
    setStatusReason('');
  };

  const handleStatusConfirm = () => {
    if (!selectedDoctor || !actionType || !statusReason.trim()) return;
    const next: AccountStatus = actionType === 'enable' ? 'active' : 'disabled';
    setDoctors((list) =>
      list.map((d) => (d.id === selectedDoctor.id ? { ...d, accountStatus: next } : d)),
    );
    setShowConfirm(false);
    setActionType(null);
    setStatusReason('');
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">返回医生账户管理</span>
        </button>

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Search className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">查询/修改医生账户信息</h1>
            <p className="text-sm text-gray-600 mt-1">
              查看与编辑医生资料，并在此启用或禁用账户登录
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">搜索医生账户</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="search-type">搜索类型</Label>
            <Select value={searchType} onValueChange={setSearchType}>
              <SelectTrigger id="search-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">医生姓名</SelectItem>
                <SelectItem value="account">医生账号</SelectItem>
                <SelectItem value="phone">手机号码</SelectItem>
                <SelectItem value="hospital">所属医院</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="search-value">搜索内容</Label>
            <div className="flex gap-2">
              <Input
                id="search-value"
                placeholder="请输入搜索内容"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
              <Button
                type="button"
                onClick={handleSearch}
                className="bg-gradient-to-r from-teal-500 to-cyan-600"
              >
                <Search className="w-4 h-4 mr-2" />
                搜索
              </Button>
            </div>
          </div>
        </div>
      </div>

      {doctors.length === 0 && (
        <div className="mb-6 rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-8 text-center text-sm text-gray-500">
          暂无医生数据。接入后端账户列表后，可在此检索并维护医生信息。
        </div>
      )}

      {selectedDoctor && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-lg p-4 border border-teal-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <UserCircle className="w-6 h-6 text-teal-600" />
              <div>
                <span className="font-medium text-teal-900">当前查看：{selectedDoctor.name}</span>
                <Badge variant="secondary" className="ml-2">
                  {selectedDoctor.certificationStatus}
                </Badge>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
              className="border-teal-300 text-teal-700 hover:bg-teal-50 shrink-0"
            >
              <Edit className="w-4 h-4 mr-2" />
              {isEditing ? '取消编辑' : '编辑信息'}
            </Button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">基本信息</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>医生姓名</Label>
                {isEditing ? (
                  <Input defaultValue={selectedDoctor.name} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg">{selectedDoctor.name}</div>
                )}
              </div>
              <div className="space-y-2">
                <Label>医生账号</Label>
                <div className="p-2 bg-gray-50 rounded-lg">{selectedDoctor.account}</div>
              </div>
              <div className="space-y-2">
                <Label>专业科室</Label>
                {isEditing ? (
                  <Input defaultValue={selectedDoctor.specialty} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg">{selectedDoctor.specialty}</div>
                )}
              </div>
              <div className="space-y-2">
                <Label>职称</Label>
                {isEditing ? (
                  <Select defaultValue={selectedDoctor.title}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="主任医师">主任医师</SelectItem>
                      <SelectItem value="副主任医师">副主任医师</SelectItem>
                      <SelectItem value="主治医师">主治医师</SelectItem>
                      <SelectItem value="住院医师">住院医师</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-500" />
                    {selectedDoctor.title}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">联系方式</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>手机号码</Label>
                {isEditing ? (
                  <Input defaultValue={selectedDoctor.phone} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                    <Phone className="w-4 h-4 text-teal-500" />
                    {selectedDoctor.phone}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>电子邮箱</Label>
                {isEditing ? (
                  <Input defaultValue={selectedDoctor.email} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                    <Mail className="w-4 h-4 text-teal-500" />
                    {selectedDoctor.email}
                  </div>
                )}
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>所属医院</Label>
                {isEditing ? (
                  <Input defaultValue={selectedDoctor.hospital} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                    <Building className="w-4 h-4 text-teal-500" />
                    {selectedDoctor.hospital}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">专业信息</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>从业年限</Label>
                <div className="p-2 bg-gray-50 rounded-lg">{selectedDoctor.yearsOfExperience}</div>
              </div>
              <div className="space-y-2">
                <Label>学历</Label>
                <div className="p-2 bg-gray-50 rounded-lg">{selectedDoctor.education}</div>
              </div>
              <div className="space-y-2">
                <Label>注册日期</Label>
                <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-teal-500" />
                  {selectedDoctor.registrationDate}
                </div>
              </div>
            </div>
          </div>

          <div
            className={`rounded-xl border p-6 ${
              selectedDoctor.accountStatus === 'active'
                ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200'
                : 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                {selectedDoctor.accountStatus === 'active' ? (
                  <Unlock className="w-6 h-6 text-emerald-600" />
                ) : (
                  <Lock className="w-6 h-6 text-red-600" />
                )}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">账户登录状态</h3>
                  <p className="text-sm text-gray-600">控制是否允许该医生登录系统</p>
                </div>
              </div>
              <Badge
                className={`text-sm px-4 py-2 w-fit ${
                  selectedDoctor.accountStatus === 'active' ? 'bg-emerald-600' : 'bg-red-600'
                }`}
              >
                {getAccountStatusInfo(selectedDoctor.accountStatus).label}
              </Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-white rounded-lg p-3 md:col-span-2">
                <p className="text-xs text-gray-600">最后登录</p>
                <p className="font-medium text-gray-900 text-sm">{selectedDoctor.lastLogin}</p>
              </div>
              <div className="bg-white rounded-lg p-3 md:col-span-2">
                <p className="text-xs text-gray-600">档案状态</p>
                <p className="font-medium text-gray-900">{selectedDoctor.recordStatus}</p>
              </div>
            </div>

            {!showConfirm && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-emerald-200 rounded-lg p-5 bg-white/80">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Unlock className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 mb-1">启用账户</h4>
                      <p className="text-sm text-gray-600">恢复访问权限，允许登录</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => handleStatusActionClick('enable')}
                    disabled={selectedDoctor.accountStatus === 'active'}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Unlock className="w-4 h-4 mr-2" />
                    {selectedDoctor.accountStatus === 'active' ? '账户已启用' : '启用此账户'}
                  </Button>
                </div>
                <div className="border border-red-200 rounded-lg p-5 bg-white/80">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Lock className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 mb-1">禁用账户</h4>
                      <p className="text-sm text-gray-600">暂停访问权限，禁止登录</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => handleStatusActionClick('disable')}
                    disabled={selectedDoctor.accountStatus === 'disabled'}
                    variant="destructive"
                    className="w-full"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    {selectedDoctor.accountStatus === 'disabled' ? '账户已禁用' : '禁用此账户'}
                  </Button>
                </div>
              </div>
            )}

            {showConfirm && actionType && (
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <div
                  className={`rounded-lg p-4 mb-4 ${
                    actionType === 'enable'
                      ? 'bg-emerald-50 border border-emerald-200'
                      : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className={`w-5 h-5 ${
                        actionType === 'enable' ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    />
                    <span className="font-semibold text-gray-900">
                      确认{actionType === 'enable' ? '启用' : '禁用'}账户
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-2 ml-7">
                    您即将{actionType === 'enable' ? '启用' : '禁用'}：
                    <span className="font-medium text-gray-900">
                      {' '}
                      {selectedDoctor.name}（{selectedDoctor.account}）
                    </span>
                  </p>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="status-reason">
                      操作原因 <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="status-reason"
                      placeholder={`请输入${actionType === 'enable' ? '启用' : '禁用'}原因…`}
                      value={statusReason}
                      onChange={(e) => setStatusReason(e.target.value)}
                      rows={4}
                      className="mt-2"
                    />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      onClick={handleStatusConfirm}
                      disabled={!statusReason.trim()}
                      className={
                        actionType === 'enable'
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-red-600 hover:bg-red-700'
                      }
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      确认{actionType === 'enable' ? '启用' : '禁用'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowConfirm(false);
                        setActionType(null);
                        setStatusReason('');
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {isEditing && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex gap-3">
                <Button
                  type="button"
                  className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700"
                >
                  保存修改
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>
                  取消
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
