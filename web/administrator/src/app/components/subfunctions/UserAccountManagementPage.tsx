import React, { useState } from 'react';
import { ArrowLeft, Users, UserPlus, UserMinus, Search, Check, X } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table';
import { Badge } from '@/app/components/ui/badge';

interface UserAccountManagementPageProps {
  onBack: () => void;
}

type UserListRow = {
  id: number;
  name: string;
  username: string;
  phone: string;
  age: number;
  gender: string;
  status: 'active' | 'inactive';
  createdAt: string;
};

export function UserAccountManagementPage({ onBack }: UserAccountManagementPageProps) {
  const [activeTab, setActiveTab] = useState<'register' | 'unregister'>('register');
  const [gender, setGender] = useState('');
  const [users] = useState<UserListRow[]>([]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">返回用户账户管理</span>
        </button>

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Users className="w-7 h-7 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">注册/注销用户账户</h1>
            <p className="text-sm text-gray-600 mt-1">管理患者用户账户的创建和注销</p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('register')}
          className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
            activeTab === 'register'
              ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-md'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            <span>注册用户</span>
          </div>
        </button>
        <button
          onClick={() => setActiveTab('unregister')}
          className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
            activeTab === 'unregister'
              ? 'bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-md'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <UserMinus className="w-4 h-4" />
            <span>注销用户</span>
          </div>
        </button>
      </div>

      {/* Content */}
      {activeTab === 'register' ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">创建用户账户</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name">用户姓名 *</Label>
              <Input id="name" placeholder="请输入用户姓名" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">用户名 *</Label>
              <Input id="username" placeholder="请输入用户名" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">手机号码 *</Label>
              <Input id="phone" placeholder="请输入手机号码" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" placeholder="请输入邮箱地址" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="age">年龄</Label>
              <Input id="age" type="number" placeholder="请输入年龄" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gender">性别 *</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger id="gender" className="w-full">
                  <SelectValue placeholder="请选择性别" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="男">男</SelectItem>
                  <SelectItem value="女">女</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">初始密码 *</Label>
              <Input id="password" type="password" placeholder="请设置初始密码" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">确认密码 *</Label>
              <Input id="confirm-password" type="password" placeholder="请再次输入密码" />
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Button className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700">
              <Check className="w-4 h-4 mr-2" />
              创建账户
            </Button>
            <Button variant="outline">
              <X className="w-4 h-4 mr-2" />
              重置
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input placeholder="搜索用户姓名、用户名或手机号..." className="pl-10" />
              </div>
              <Button variant="outline">搜索</Button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead>年龄</TableHead>
                  <TableHead>性别</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>注册时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-sm text-gray-500">
                      暂无用户记录，接入账户接口后将在此展示。
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.username}</TableCell>
                      <TableCell>{user.phone}</TableCell>
                      <TableCell>{user.age}</TableCell>
                      <TableCell>{user.gender}</TableCell>
                      <TableCell>
                        {user.status === 'active' ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            启用中
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                            已停用
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{user.createdAt}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="destructive" size="sm">
                          <UserMinus className="w-4 h-4 mr-1" />
                          注销
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
