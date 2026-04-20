import React from 'react';
import { LucideIcon, ArrowLeft, ChevronRight } from 'lucide-react';
import { DoctorAccountChart } from './DoctorAccountChart';
import { UserAccountChart } from './UserAccountChart';
import { DatabaseChart } from './DatabaseChart';
import { SystemSettingsChart } from './SystemSettingsChart';

interface SubFunction {
  name: string;
  description?: string;
}

interface ModuleDetailPageProps {
  title: string;
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
  subFunctions: SubFunction[];
  onBack: () => void;
  onSubFunctionClick?: (subFunctionName: string) => void;
}

export function ModuleDetailPage({
  title,
  icon: Icon,
  iconColor,
  iconBgColor,
  subFunctions,
  onBack,
  onSubFunctionClick,
}: ModuleDetailPageProps) {
  // 根据模块标题选择对应的图表组件
  const renderChart = () => {
    switch (title) {
      case '医生账户管理':
        return <DoctorAccountChart />;
      case '用户账户管理':
        return <UserAccountChart />;
      case '医疗数据库管理':
        return <DatabaseChart />;
      case '其它':
        return <SystemSettingsChart />;
      default:
        return null;
    }
  };

  return (
    <div className="p-6">
      {/* Back Button and Page Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">返回工作台</span>
        </button>

        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 ${iconBgColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-7 h-7 ${iconColor}`} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
            <p className="text-sm text-gray-600 mt-1">
              共 {subFunctions.length} 项功能
            </p>
          </div>
        </div>
      </div>

      {/* Sub Functions Grid - 优化的布局 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {subFunctions.map((func, index) => (
          <div
            key={index}
            className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-lg hover:border-teal-300 transition-all duration-300 cursor-pointer group overflow-hidden"
            onClick={() => onSubFunctionClick && onSubFunctionClick(func.name)}
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                    <span className="text-white font-semibold">{index + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 mb-1 group-hover:text-teal-600 transition-colors">
                      {func.name}
                    </h3>
                    {func.description && (
                      <p className="text-sm text-gray-600 leading-relaxed">{func.description}</p>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-teal-600 group-hover:translate-x-1 transition-all flex-shrink-0 ml-2" />
              </div>
            </div>
            
            {/* 悬浮效果的底部条纹 */}
            <div className="h-1 bg-gradient-to-r from-teal-500 to-cyan-600 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
          </div>
        ))}
      </div>

      {/* 数据统计图表区域 */}
      <div className="mb-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900">数据统计</h2>
          <p className="text-sm text-gray-600 mt-1">查看模块相关的统计数据和趋势分析</p>
        </div>
        {renderChart()}
      </div>
    </div>
  );
}