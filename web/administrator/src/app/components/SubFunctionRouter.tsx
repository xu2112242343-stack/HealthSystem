import React from 'react';
import { AdminUserManagementMvpPage } from './subfunctions/AdminUserManagementMvpPage';
import { AdminDoctorManagementMvpPage } from './subfunctions/AdminDoctorManagementMvpPage';
import { HealthContentPage } from './subfunctions/HealthContentPage';
import { HospitalInfoPage } from './subfunctions/HospitalInfoPage';
import { ThirdPartyServicePage } from './subfunctions/ThirdPartyServicePage';

interface SubFunctionRouterProps {
  moduleTitle: string;
  subFunctionName: string;
  onBack: () => void;
}

class SubFunctionErrorBoundary extends React.Component<
  { children: React.ReactNode; onBack: () => void },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode; onBack: () => void }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : '子页面渲染异常';
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown) {
    // 方便本地调试时在控制台定位白屏根因
    // eslint-disable-next-line no-console
    console.error('[admin-subfunction-error]', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6">
          <div className="bg-white rounded-xl border border-red-200 shadow-sm p-8 text-center">
            <h2 className="text-xl font-semibold text-red-700 mb-2">页面加载失败</h2>
            <p className="text-gray-600 mb-4">{this.state.message || '请刷新后重试'}</p>
            <button onClick={this.props.onBack} className="text-teal-600 hover:text-teal-700 font-medium">
              返回上一页
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function SubFunctionRouter({ moduleTitle, subFunctionName, onBack }: SubFunctionRouterProps) {
  // 根据模块和子功能名称渲染对应的页面
  const renderSubFunctionPage = () => {
    const key = `${moduleTitle}-${subFunctionName}`;

    switch (key) {
      // 医生账户管理
      case '医生账户管理-注册/注销医生账户':
        return <AdminDoctorManagementMvpPage onBack={onBack} />;
      case '医生账户管理-查询/修改医生账户信息':
        return <AdminDoctorManagementMvpPage onBack={onBack} />;

      // 用户账户管理
      case '用户账户管理-注册/注销用户账户':
        return <AdminUserManagementMvpPage onBack={onBack} />;
      case '用户账户管理-查询/修改用户信息':
        return <AdminUserManagementMvpPage onBack={onBack} />;

      // 医疗数据库管理
      case '医疗数据库管理-健康内容':
        return <HealthContentPage onBack={onBack} />;
      case '医疗数据库管理-医院信息':
        return <HospitalInfoPage onBack={onBack} />;

      // 其它
      case '其它-第三方服务接入':
        return <ThirdPartyServicePage onBack={onBack} />; // 可以创建新组件或复用

      default:
        return (
          <div className="p-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                功能开发中
              </h2>
              <p className="text-gray-600 mb-4">
                {moduleTitle} - {subFunctionName}
              </p>
              <button
                onClick={onBack}
                className="text-teal-600 hover:text-teal-700 font-medium"
              >
                返回上一页
              </button>
            </div>
          </div>
        );
    }
  };

  return <SubFunctionErrorBoundary onBack={onBack}>{renderSubFunctionPage()}</SubFunctionErrorBoundary>;
}