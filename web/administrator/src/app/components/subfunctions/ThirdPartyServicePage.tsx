import React, { useState } from 'react';
import { ArrowLeft, Settings, Plus, Edit, Trash2, Power, Shield } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Badge } from '@/app/components/ui/badge';
import { Switch } from '@/app/components/ui/switch';

interface ThirdPartyServicePageProps {
  onBack: () => void;
}

type ServiceRow = {
  id: number;
  name: string;
  type: string;
  description: string;
  apiKey: string;
  status: 'active' | 'inactive';
  lastSyncTime: string;
  monthlyUsage: string;
};

export function ThirdPartyServicePage({ onBack }: ThirdPartyServicePageProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [services] = useState<ServiceRow[]>([]);

  const enabledCount = services.filter((s) => s.status === 'active').length;
  const inactiveCount = services.filter((s) => s.status === 'inactive').length;
  const typeCount = new Set(services.map((s) => s.type)).size;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">返回其它管理</span>
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <Settings className="w-7 h-7 text-gray-600" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">第三方服务接入</h1>
              <p className="text-sm text-gray-600 mt-1">管理第三方服务的集成配置</p>
            </div>
          </div>
          <Button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            添加服务
          </Button>
        </div>
      </div>

      {/* Add Service Form */}
      {showAddForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">添加第三方服务</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="service-name">服务名称 *</Label>
              <Input id="service-name" placeholder="请输入服务名称" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-type">服务类型 *</Label>
              <Input id="service-type" placeholder="如：通讯服务、存储服务等" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">服务描述</Label>
              <Input id="description" placeholder="请输入服务描述" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key">API Key *</Label>
              <Input id="api-key" type="password" placeholder="请输入API密钥" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-secret">API Secret *</Label>
              <Input id="api-secret" type="password" placeholder="请输入API密钥" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="endpoint">服务端点 URL</Label>
              <Input id="endpoint" placeholder="https://api.example.com" />
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Button className="bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700">
              保存配置
            </Button>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
          <div className="text-sm text-green-600 mb-1">已启用服务</div>
          <div className="text-2xl font-bold text-green-900 tabular-nums">{enabledCount}</div>
        </div>
        <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-lg p-4 border border-gray-200">
          <div className="text-sm text-gray-600 mb-1">已停用服务</div>
          <div className="text-2xl font-bold text-gray-900 tabular-nums">{inactiveCount}</div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg p-4 border border-blue-200">
          <div className="text-sm text-blue-600 mb-1">服务类型数</div>
          <div className="text-2xl font-bold text-blue-900 tabular-nums">{typeCount}</div>
        </div>
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-200">
          <div className="text-sm text-purple-600 mb-1">本月调用</div>
          <div className="text-2xl font-bold text-purple-900">—</div>
        </div>
      </div>

      {/* Service List */}
      <div className="space-y-4">
        {services.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 p-12 text-center text-sm text-gray-500">
            暂无已配置的第三方服务，添加或接入配置接口后将在此展示。
          </div>
        ) : (
          services.map((service) => (
          <div key={service.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">{service.name}</h3>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    {service.type}
                  </Badge>
                  {service.status === 'active' ? (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      已启用
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                      已停用
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-gray-600 mb-3">{service.description}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">API Key：</span>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded">{service.apiKey}</code>
                      <Shield className="w-3 h-3 text-gray-400" />
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600">最后同步：</span>
                    <div className="text-gray-900 mt-1">{service.lastSyncTime}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">本月使用量：</span>
                    <div className="text-gray-900 mt-1">{service.monthlyUsage}</div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 ml-4">
                <Button variant="outline" size="sm">
                  <Edit className="w-4 h-4" />
                </Button>
                <Button variant="destructive" size="sm">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <Power className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-700">服务状态</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">
                  {service.status === 'active' ? '已启用' : '已停用'}
                </span>
                <Switch checked={service.status === 'active'} />
              </div>
            </div>
          </div>
        ))
        )}
      </div>
    </div>
  );
}
