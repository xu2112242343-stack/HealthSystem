import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from '@/app/components/Sidebar';
import { TopBar } from '@/app/components/TopBar';
import { ProfileModal } from '@/app/components/ProfileModal';
import { HomePage } from '@/app/pages/HomePage';
import { DataCollection } from '@/app/pages/DataCollection';
import {RiskAssessment} from '@/app/pages/RiskAssessment';
import { Intervention } from '@/app/pages/Intervention';
import { HealthLogPage } from '@/app/pages/HealthLogPage';
import { syncSessionWithJwtForUser } from '@/lib/portalSession';
import { ACCESS_TOKEN_CHANGED_EVENT, getStoredAccessToken } from '@/lib/api';
import { fetchAppAccess } from '@/lib/api/appAccess';
import { QUESTIONNAIRE_UPDATED_EVENT } from '@/lib/questionnaireSnapshot';

type AppAccessRunKind = 'mount' | 'token' | 'refresh';

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentPage, setCurrentPage] = useState('dataCollection');
  const [lockToDataCollection, setLockToDataCollection] = useState(true);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const pendingFirstFillLandingRef = useRef(false);

  const applyAppAccess = useCallback(async (kind: AppAccessRunKind) => {
    const token = getStoredAccessToken();
    if (!token) {
      setLockToDataCollection(true);
      setCurrentPage('dataCollection');
      return;
    }
    try {
      const { fullNavigation } = await fetchAppAccess();
      if (fullNavigation) {
        setLockToDataCollection(false);
        if (kind === 'mount') {
          const preferData = pendingFirstFillLandingRef.current;
          pendingFirstFillLandingRef.current = false;
          setCurrentPage(preferData ? 'dataCollection' : 'home');
        } else if (kind === 'token') {
          setCurrentPage('home');
        }
      } else {
        setLockToDataCollection(true);
        setCurrentPage('dataCollection');
      }
    } catch {
      setLockToDataCollection(true);
      setCurrentPage('dataCollection');
    }
  }, []);

  useEffect(() => {
    syncSessionWithJwtForUser();
    const u = new URL(window.location.href);
    if (u.searchParams.get('first_fill') === '1') {
      pendingFirstFillLandingRef.current = true;
      u.searchParams.delete('first_fill');
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    }

    void applyAppAccess('mount');

    const onToken = () => {
      void applyAppAccess('token');
    };
    const onQuestionnaireUpdated = () => {
      void applyAppAccess('refresh');
    };

    window.addEventListener(ACCESS_TOKEN_CHANGED_EVENT, onToken);
    window.addEventListener(QUESTIONNAIRE_UPDATED_EVENT, onQuestionnaireUpdated);
    return () => {
      window.removeEventListener(ACCESS_TOKEN_CHANGED_EVENT, onToken);
      window.removeEventListener(QUESTIONNAIRE_UPDATED_EVENT, onQuestionnaireUpdated);
    };
  }, [applyAppAccess]);

  useEffect(() => {
    if (lockToDataCollection && currentPage !== 'dataCollection') {
      setCurrentPage('dataCollection');
    }
  }, [lockToDataCollection, currentPage]);

  //从主页中监听导航事件
  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const customEvent = e as CustomEvent;
      const next = String(customEvent.detail || '');
      if (lockToDataCollection && next !== 'dataCollection') {
        setCurrentPage('dataCollection');
        return;
      }
      setCurrentPage(next);
    };

    window.addEventListener('navigate', handleNavigate);

    return () => {
      window.removeEventListener('navigate', handleNavigate);
    };
  }, [lockToDataCollection]);

  const pageConfig = {
    home: { title: '用户首页', component: HomePage },
    dataCollection: { title: '健康数据', component: DataCollection },
    riskAssessment: { title: '风险评估', component: RiskAssessment },
    intervention: { title: '干预方案', component: Intervention },
    healthLog: { title: '健康档案', component: HealthLogPage },
  };

  const CurrentPageComponent = pageConfig[currentPage as keyof typeof pageConfig]?.component || HomePage;
  const currentTitle = pageConfig[currentPage as keyof typeof pageConfig]?.title || '用户首页';

  return(
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar
        isCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        currentPage={currentPage}
        onNavigate={(p) => {
          if (lockToDataCollection && p !== 'dataCollection') {
            setCurrentPage('dataCollection');
            return;
          }
          setCurrentPage(p);
        }}
        lockToDataCollection={lockToDataCollection}
        onProfileClick={() => setProfileModalOpen(true)}
      />

      {/* Top Bar */}
      <TopBar 
        sidebarCollapsed={sidebarCollapsed} 
        currentModule={currentTitle}
      />

      {/*主内容区*/}
      <main
        className={`pt-14 transition-all duration-300 ${
          sidebarCollapsed ? 'ml-16' : 'ml-64'
        }`}
      >
        <CurrentPageComponent />
      </main>

      {/* Profile Modal */}
      <ProfileModal isOpen={profileModalOpen} onClose={() => setProfileModalOpen(false)} />
    </div>
  );
}

export default App;
