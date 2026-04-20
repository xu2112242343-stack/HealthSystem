import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Search,
  Edit,
  UserCircle,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Activity,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Textarea } from '@/app/components/ui/textarea';

interface UserInfoQueryPageProps {
  onBack: () => void;
}

type AccountStatus = 'active' | 'disabled';

interface PatientUser {
  id: string;
  name: string;
  account: string;
  phone: string;
  email: string;
  gender: string;
  age: number;
  address: string;
  registrationDate: string;
  lastLogin: string;
  status: string;
  riskLevel: string;
  diagnosisHistory: string;
  accountStatus: AccountStatus;
}

const initialUsers: PatientUser[] = [];

function getAccountStatusInfo(status: AccountStatus) {
  switch (status) {
    case 'active':
      return { label: '已启用', color: 'bg-emerald-100 text-emerald-700' };
    case 'disabled':
      return { label: '已禁用', color: 'bg-red-100 text-red-700' };
    default:
      return { label: '未知', color: 'bg-gray-100 text-gray-700' };
  }
}

export function UserInfoQueryPage({ onBack }: UserInfoQueryPageProps) {
  const [searchType, setSearchType] = useState('name');
  const [searchValue, setSearchValue] = useState('');
  const [users, setUsers] = useState<PatientUser[]>(initialUsers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [actionType, setActionType] = useState<'enable' | 'disable' | null>(null);
  const [statusReason, setStatusReason] = useState('');

  const selectedUser = useMemo(
    () => (selectedId ? users.find((u) => u.id === selectedId) ?? null : null),
    [users, selectedId],
  );

  const handleSearch = () => {
    const q = searchValue.trim().toLowerCase();
    if (!q) return;
    const found = users.find((u) => {
      switch (searchType) {
        case 'name':
          return u.name.toLowerCase().includes(q);
        case 'account':
          return u.account.toLowerCase().includes(q);
        case 'phone':
          return u.phone.includes(searchValue.trim());
        case 'email':
          return u.email.toLowerCase().includes(q);
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
    if (!selectedUser || !actionType || !statusReason.trim()) return;
    const next: AccountStatus = actionType === 'enable' ? 'active' : 'disabled';
    setUsers((list) =>
      list.map((u) => (u.id === selectedUser.id ? { ...u, accountStatus: next } : u)),
    );
    setShowConfirm(false);
    setActionType(null);
    setStatusReason('');
  };

  const accountInfo = selectedUser ? getAccountStatusInfo(selectedUser.accountStatus) : null;

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">返回用户账户管理</span>
        </button>

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Search className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">查询/修改用户信息</h1>
            <p className="text-sm text-gray-600 mt-1">
              搜索并维护用户资料，并在此启用或禁用账户登录
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">搜索用户账户</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="search-type">搜索类型</Label>
            <Select value={searchType} onValueChange={setSearchType}>
              <SelectTrigger id="search-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">用户姓名</SelectItem>
                <SelectItem value="account">用户账号</SelectItem>
                <SelectItem value="phone">手机号码</SelectItem>
                <SelectItem value="email">电子邮箱</SelectItem>
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

      {users.length === 0 && (
        <div className="mb-6 rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-8 text-center text-sm text-gray-500">
          暂无用户数据。接入后端用户列表后，可在此检索并维护用户信息。
        </div>
      )}

      {selectedUser && accountInfo && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-cyan-50 to-blue-50 rounded-lg p-4 border border-cyan-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <UserCircle className="w-6 h-6 text-cyan-600 shrink-0" />
              <span className="font-medium text-cyan-900">当前查看：{selectedUser.name}</span>
              <Badge variant="secondary" className="ml-0 sm:ml-2">
                {selectedUser.status}
              </Badge>
              <Badge variant="secondary" className={accountInfo.color}>
                {accountInfo.label}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
              className="border-cyan-300 text-cyan-700 hover:bg-cyan-50 shrink-0"
            >
              <Edit className="w-4 h-4 mr-2" />
              {isEditing ? '取消编辑' : '编辑信息'}
            </Button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">基本信息</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>用户姓名</Label>
                {isEditing ? (
                  <Input defaultValue={selectedUser.name} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg">{selectedUser.name}</div>
                )}
              </div>
              <div className="space-y-2">
                <Label>用户账号</Label>
                <div className="p-2 bg-gray-50 rounded-lg">{selectedUser.account}</div>
              </div>
              <div className="space-y-2">
                <Label>性别</Label>
                {isEditing ? (
                  <Select defaultValue={selectedUser.gender}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="男">男</SelectItem>
                      <SelectItem value="女">女</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg">{selectedUser.gender}</div>
                )}
              </div>
              <div className="space-y-2">
                <Label>年龄</Label>
                {isEditing ? (
                  <Input type="number" defaultValue={selectedUser.age} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg">{selectedUser.age} 岁</div>
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
                  <Input defaultValue={selectedUser.phone} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                    <Phone className="w-4 h-4 text-cyan-500" />
                    {selectedUser.phone}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>电子邮箱</Label>
                {isEditing ? (
                  <Input defaultValue={selectedUser.email} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                    <Mail className="w-4 h-4 text-cyan-500" />
                    {selectedUser.email}
                  </div>
                )}
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>居住地址</Label>
                {isEditing ? (
                  <Input defaultValue={selectedUser.address} />
                ) : (
                  <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-cyan-500" />
                    {selectedUser.address}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">健康信息</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>风险等级</Label>
                <div className="p-2 bg-gray-50 rounded-lg">
                  <Badge
                    className={
                      selectedUser.riskLevel === '高风险'
                        ? 'bg-red-600'
                        : selectedUser.riskLevel === '中风险'
                          ? 'bg-amber-600'
                          : 'bg-emerald-600'
                    }
                  >
                    {selectedUser.riskLevel}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>诊断历史</Label>
                <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-500" />
                  {selectedUser.diagnosisHistory}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">账户信息</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>注册日期</Label>
                <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-cyan-500" />
                  {selectedUser.registrationDate}
                </div>
              </div>
              <div className="space-y-2">
                <Label>最后登录</Label>
                <div className="p-2 bg-gray-50 rounded-lg flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-cyan-500" />
                  {selectedUser.lastLogin}
                </div>
              </div>
            </div>
          </div>

          <div
            className={`rounded-xl border p-6 ${
              selectedUser.accountStatus === 'active'
                ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200'
                : 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                {selectedUser.accountStatus === 'active' ? (
                  <Unlock className="w-6 h-6 text-emerald-600" />
                ) : (
                  <Lock className="w-6 h-6 text-red-600" />
                )}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">账户登录状态</h3>
                  <p className="text-sm text-gray-600">控制是否允许该用户登录系统</p>
                </div>
              </div>
              <Badge
                className={`text-sm px-4 py-2 w-fit ${
                  selectedUser.accountStatus === 'active' ? 'bg-emerald-600' : 'bg-red-600'
                }`}
              >
                {getAccountStatusInfo(selectedUser.accountStatus).label}
              </Badge>
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
                    disabled={selectedUser.accountStatus === 'active'}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Unlock className="w-4 h-4 mr-2" />
                    {selectedUser.accountStatus === 'active' ? '账户已启用' : '启用此账户'}
                  </Button>
                </div>
                <div className="border border-red-200 rounded-lg p-5 bg-white/80">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Lock className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 mb-1">禁用账户</h4>
                      <p className="text-sm text-gray-600">暂停用户账户的访问权限，禁止登录</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => handleStatusActionClick('disable')}
                    disabled={selectedUser.accountStatus === 'disabled'}
                    variant="destructive"
                    className="w-full"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    {selectedUser.accountStatus === 'disabled' ? '账户已禁用' : '禁用此账户'}
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
                      {selectedUser.name}（{selectedUser.account}）
                    </span>
                  </p>
                </div>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="user-info-status-reason">
                      操作原因 <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                      id="user-info-status-reason"
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
