import React, { useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DoctorWorkbenchDashboard } from './components/DoctorWorkbenchDashboard';
import { RiskAssessment } from './components/RiskAssessment';
import { FollowUpHistory } from './components/FollowUpHistory';
import { PersonalCenterModal, type AccountProfileForm } from './components/PersonalCenterModal';

type Page = 'dashboard' | 'risk' | 'followup';

/** 用户端可改为「用户」等 */
const ACCOUNT_ROLE_LABEL = '医生';

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [personalCenterOpen, setPersonalCenterOpen] = useState(false);
  const [accountProfile, setAccountProfile] = useState<AccountProfileForm>({
    name: '',
    phone: '',
    email: '',
  });
  /** 侧栏副文案（不在弹窗基本资料内编辑，与账户接口字段对齐后可合并） */
  const [userSubtitle] = useState('心血管内科 | 主任医师');

  const userDisplayName = useMemo(() => {
    const n = accountProfile.name.trim();
    return n ? `${n} ${ACCOUNT_ROLE_LABEL}` : ACCOUNT_ROLE_LABEL;
  }, [accountProfile.name]);

  const userAvatarChar = useMemo(() => {
    const n = accountProfile.name.trim();
    return n ? n.slice(0, 1) : '医';
  }, [accountProfile.name]);

  const pageTitles: Record<Page, string> = {
    dashboard: '风险评估工作台',
    risk: '疾病分析',
    followup: '患者随访历史',
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'risk':
        return <RiskAssessment />;
      case 'followup':
        return <FollowUpHistory />;
      case 'dashboard':
      default:
        return <DoctorWorkbenchDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar
        isCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        userDisplayName={userDisplayName}
        userSubtitle={userSubtitle}
        userAvatarChar={userAvatarChar}
        onOpenPersonalCenter={() => setPersonalCenterOpen(true)}
      />

      <PersonalCenterModal
        open={personalCenterOpen}
        onOpenChange={setPersonalCenterOpen}
        variant="doctor"
        profile={accountProfile}
        onProfileChange={setAccountProfile}
      />

      {/* Top Bar */}
      <TopBar sidebarCollapsed={sidebarCollapsed} currentModule={pageTitles[currentPage]} />

      {/* Main Content Area */}
      <main
        className={`pt-16 transition-all duration-300 ${
          sidebarCollapsed ? 'ml-16' : 'ml-64'
        }`}
      >
        {renderPage()}
      </main>
    </div>
  );
}

export default App;