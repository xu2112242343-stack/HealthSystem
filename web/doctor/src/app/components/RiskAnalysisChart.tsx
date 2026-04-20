import React, { useState } from 'react';
import { 
  RadarChart, 
  Radar, 
  PolarGrid, 
  PolarAngleAxis, 
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ZAxis
} from 'recharts';
import { Shield, PieChart } from 'lucide-react';

const radarData = [
  { subject: '心血管系统', value: 65, fullMark: 100 },
  { subject: '代谢', value: 78, fullMark: 100 },
  { subject: '呼吸', value: 45, fullMark: 100 },
  { subject: '肝肾功能', value: 88, fullMark: 100 },
  { subject: '消化系统', value: 70, fullMark: 100 },
];

const scatterData = [
  { x: 25, y: 65, z: 80, risk: 'high' },
  { x: 35, y: 45, z: 60, risk: 'high' },
  { x: 45, y: 75, z: 90, risk: 'high' },
  { x: 55, y: 35, z: 50, risk: 'medium' },
  { x: 65, y: 55, z: 70, risk: 'medium' },
  { x: 28, y: 80, z: 85, risk: 'high' },
  { x: 75, y: 25, z: 40, risk: 'low' },
  { x: 85, y: 45, z: 55, risk: 'low' },
  { x: 42, y: 70, z: 75, risk: 'medium' },
  { x: 58, y: 50, z: 65, risk: 'medium' },
  { x: 70, y: 38, z: 48, risk: 'low' },
  { x: 32, y: 72, z: 82, risk: 'high' },
];

type Page = 'dashboard' | 'risk';

interface RiskAnalysisChartProps {
  onPageChange?: (page: Page) => void;
}

export function RiskAnalysisChart({ onPageChange }: RiskAnalysisChartProps) {
  const [activeTab, setActiveTab] = useState<'radar' | 'scatter'>('radar');

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">群体风险分析与患者画像</h3>
          <p className="text-sm text-gray-500 mt-1">基于最近 30 天患者数据的多维疾病分析视图</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('radar')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'radar'
                ? 'bg-teal-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            雷达图
          </button>
          <button
            onClick={() => setActiveTab('scatter')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'scatter'
                ? 'bg-teal-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            风险人群分布
          </button>
        </div>
      </div>

      {/* Chart Display Area - 2 columns layout */}
      <div className="grid grid-cols-2 gap-6 flex-1 mb-6">
        {/* Left Side - Chart */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-gray-700">
              {activeTab === 'radar' ? '主要风险领域' : '风险人群分布'}
            </h4>
          </div>
          
          {activeTab === 'radar' ? (
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis 
                  dataKey="subject" 
                  tick={{ fill: '#6b7280', fontSize: 12 }}
                />
                <Radar
                  name="风险指数"
                  dataKey="value"
                  stroke="#14b8a6"
                  fill="#14b8a6"
                  fillOpacity={0.5}
                />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div>
              <ResponsiveContainer width="100%" height={240}>
                <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    type="number" 
                    dataKey="x" 
                    name="年龄" 
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    domain={[0, 100]}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="y" 
                    name="风险值" 
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    domain={[0, 100]}
                  />
                  <ZAxis type="number" dataKey="z" range={[40, 300]} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter 
                    name="高风险" 
                    data={scatterData.filter(d => d.risk === 'high')} 
                    fill="#ef4444"
                    fillOpacity={0.6}
                  />
                  <Scatter 
                    name="中风险" 
                    data={scatterData.filter(d => d.risk === 'medium')} 
                    fill="#f97316"
                    fillOpacity={0.6}
                  />
                  <Scatter 
                    name="低风险" 
                    data={scatterData.filter(d => d.risk === 'low')} 
                    fill="#14b8a6"
                    fillOpacity={0.6}
                  />
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                  <span className="text-xs text-gray-600">高风险</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                  <span className="text-xs text-gray-600">中风险</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-teal-500"></div>
                  <span className="text-xs text-gray-600">低风险</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side - Progress Bars */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-gray-700">代谢功能</h4>
          </div>
          <div className="space-y-6 flex-1 flex flex-col justify-center">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">心血管系统</span>
                <span className="text-sm font-semibold text-red-600">高风险 (85%)</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-red-500 to-red-600 rounded-full"
                  style={{ width: '85%' }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">代谢功能</span>
                <span className="text-sm font-semibold text-orange-600">中风险 (62%)</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-orange-500 to-orange-600 rounded-full"
                  style={{ width: '62%' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Function Cards - Inside the component */}
      <div className="mt-auto grid grid-cols-1 gap-4 sm:max-w-sm">
        <button
          type="button"
          onClick={() => onPageChange?.('risk')}
          className="bg-sky-50 rounded-xl p-6 border border-sky-100 hover:bg-gradient-to-br hover:from-slate-700 hover:to-slate-800 hover:border-slate-700 hover:text-white transition-all cursor-pointer transform hover:scale-105 group"
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-14 h-14 bg-sky-100 rounded-xl flex items-center justify-center mb-3 group-hover:bg-white/20">
              <PieChart className="w-7 h-7 text-sky-600 group-hover:text-white" />
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-1 group-hover:text-white">疾病分析</h3>
            <p className="text-xs text-gray-600 group-hover:text-gray-300">多维疾病与对比</p>
          </div>
        </button>
      </div>
    </div>
  );
}