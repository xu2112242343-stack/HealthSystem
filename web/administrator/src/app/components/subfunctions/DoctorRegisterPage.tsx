import React, { useState } from 'react';
import { ArrowLeft, Stethoscope, UserPlus, UserMinus, Search, Check, X } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table';
import { Badge } from '@/app/components/ui/badge';

interface DoctorRegisterPageProps {
  onBack: () => void;
}

type DoctorListRow = {
  id: number;
  name: string;
  username: string;
  specialty: string;
  hospital: string;
  status: 'certified' | 'pending';
  createdAt: string;
};

export function DoctorRegisterPage({ onBack }: DoctorRegisterPageProps) {
  const [activeTab, setActiveTab] = useState<'register' | 'unregister'>('register');
  const [existingDoctors] = useState<DoctorListRow[]>([]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">返回医生账户管理</span>
        </button>

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-cyan-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Stethoscope className="w-7 h-7 text-cyan-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">注册/注销医生账户</h1>
            <p className="text-sm text-gray-600 mt-1">管理医生账户的创建和注销</p>
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
            <span>注册医生</span>
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
            <span>注销医生</span>
          </div>
        </button>
      </div>

      {/* Content */}
      {activeTab === 'register' ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">创建医生账户</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="name">医生姓名 *</Label>
              <Input id="name" placeholder="请输入医生姓名" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">用户名 *</Label>
              <Input id="username" placeholder="请输入用户名" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">邮箱 *</Label>
              <Input id="email" type="email" placeholder="请输入邮箱地址" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">手机号码 *</Label>
              <Input id="phone" placeholder="请输入手机号码" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="specialty">专业科室 *</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="请选择科室" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="liver">肝病科</SelectItem>
                  <SelectItem value="gastro">消化内科</SelectItem>
                  <SelectItem value="internal">内科</SelectItem>
                  <SelectItem value="surgery">外科</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hospital">所属医院 *</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="请选择医院" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hospital1">市人民医院</SelectItem>
                  <SelectItem value="hospital2">中医院</SelectItem>
                  <SelectItem value="hospital3">第三医院</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="license">医师执照号 *</Label>
              <Input id="license" placeholder="请输入医师执照号" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">职称</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="请选择职称" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resident">住院医师</SelectItem>
                  <SelectItem value="attending">主治医师</SelectItem>
                  <SelectItem value="deputy">副主任医师</SelectItem>
                  <SelectItem value="chief">主任医师</SelectItem>
                </SelectContent>
              </Select>
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
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input placeholder="搜索医生姓名、科室或医院..." className="pl-10" />
              </div>
              <Button variant="outline">搜索</Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>科室</TableHead>
                <TableHead>医院</TableHead>
                <TableHead>认证状态</TableHead>
                <TableHead>注册时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {existingDoctors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-sm text-gray-500">
                    暂无医生记录，接入账户接口后将在此展示。
                  </TableCell>
                </TableRow>
              ) : (
                existingDoctors.map((doctor) => (
                  <TableRow key={doctor.id}>
                    <TableCell className="font-medium">{doctor.name}</TableCell>
                    <TableCell>{doctor.username}</TableCell>
                    <TableCell>{doctor.specialty}</TableCell>
                    <TableCell>{doctor.hospital}</TableCell>
                    <TableCell>
                      {doctor.status === 'certified' ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          已认证
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                          待认证
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{doctor.createdAt}</TableCell>
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
      )}
    </div>
  );
}
