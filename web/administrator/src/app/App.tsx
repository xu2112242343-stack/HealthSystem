import React, { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DashboardCard } from './components/DashboardCard';
import { AdminStatisticsChart } from './components/AdminStatisticsChart';
import { SystemActivityChart } from './components/SystemActivityChart';
import { ModuleDetailPage } from './components/ModuleDetailPage';
import { SubFunctionRouter } from './components/SubFunctionRouter';
import { Stethoscope, Users, Database, Building2, FileText } from 'lucide-react';
import { fetchAdminActivityToday, fetchAdminDashboardOverview } from '@/lib/api/adminDashboard';

interface SubFunction{
  name: string;
  description?: string;
}

interface AdminModule{
  title: string;
  icon: any;
  iconColor: string;
  iconBgColor: string;
  count: number;
  subFunctions: SubFunction[];
}

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedModule, setSelectedModule] = useState<AdminModule | null>(null);
  const [selectedModuleIndex, setSelectedModuleIndex] = useState<number | null>(null);
  const [selectedSubFunction, setSelectedSubFunction] = useState<string | null>(null);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [totalDoctors, setTotalDoctors] = useState<number | null>(null);
  const [totalHospitals, setTotalHospitals] = useState<number | null>(null);
  const [totalArticles, setTotalArticles] = useState<number | null>(null);
  const [trendData, setTrendData] = useState<{ name: string; 用户注册: number; 医生注册: number }[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [activityData, setActivityData] = useState<{ time: string; 活跃用户: number; 活跃医生: number }[]>(
    [],
  );

  // 功能模块数据
  const adminModules: AdminModule[] = [
    {
      title: '医生账户管理',
      icon: Stethoscope,
      iconColor: 'text-cyan-600',
      iconBgColor: 'bg-cyan-50',
      count: 0,
      subFunctions: [
        { name: '注册/注销医生账户', description: '管理医生账户的创建和注销' },
        {
          name: '查询/修改医生账户信息',
          description: '查看与编辑资料，并启用或禁用账户登录',
        },
      ],
    },
    {
      title: '用户账户管理',
      icon: Users,
      iconColor: 'text-emerald-600',
      iconBgColor: 'bg-emerald-50',
      count: 0,
      subFunctions: [
        { name: '注册/注销用户账户', description: '管理患者用户账户的创建和注销' },
        {
          name: '查询/修改用户信息',
          description: '查看和编辑用户个人信息，并控制账户登录启用状态',
        },
      ],
    },
    {
      title: '医疗数据库管理',
      icon: Database,
      iconColor: 'text-blue-600',
      iconBgColor: 'bg-blue-50',
      count: 0,
      subFunctions: [
        { name: '健康内容', description: '维护健康科普与干预类文章库' },
        { name: '医院信息', description: '管理和维护医院信息数据库' },
      ],
    },
  ];

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDashboardLoading(true);
      try {
        const res = await fetchAdminDashboardOverview(7);
        if (cancelled) return;
        setTotalUsers(typeof res.totals?.users === 'number' ? res.totals.users : null);
        setTotalDoctors(typeof res.totals?.doctors === 'number' ? res.totals.doctors : null);
        setTotalHospitals(typeof res.totals?.hospitals === 'number' ? res.totals.hospitals : null);
        setTotalArticles(typeof res.totals?.articles === 'number' ? res.totals.articles : null);
        const list = Array.isArray(res.registrationTrend) ? res.registrationTrend : [];
        setTrendData(
          list.map((it) => ({
            name: String(it.date || '').slice(5),
            用户注册: Number.isFinite(it.user) ? it.user : 0,
            医生注册: Number.isFinite(it.doctor) ? it.doctor : 0,
          })),
        );
        const activity = await fetchAdminActivityToday();
        const activityList = Array.isArray(activity.items) ? activity.items : [];
        setActivityData(
          activityList.map((it) => ({
            time: it.hour || '',
            活跃用户: Number.isFinite(it.users) ? it.users : 0,
            活跃医生: Number.isFinite(it.doctors) ? it.doctors : 0,
          })),
        );
      } catch {
        if (cancelled) return;
        setTotalUsers(null);
        setTotalDoctors(null);
        setTotalHospitals(null);
        setTotalArticles(null);
        setTrendData([]);
        setActivityData([]);
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalUsersText = useMemo(() => (totalUsers === null ? '—' : String(totalUsers)), [totalUsers]);
  const totalDoctorsText = useMemo(
    () => (totalDoctors === null ? '—' : String(totalDoctors)),
    [totalDoctors],
  );
  const totalHospitalsText = useMemo(
    () => (totalHospitals === null ? '—' : String(totalHospitals)),
    [totalHospitals],
  );
  const totalArticlesText = useMemo(
    () => (totalArticles === null ? '—' : String(totalArticles)),
    [totalArticles],
  );

  // 如果选中了模块，显示详情页面
  if (selectedModule) {
    // 如果选中了子功能，显示子功能页面
    if (selectedSubFunction) {
      return (
        <div className="min-h-screen bg-gray-50">
          {/* Sidebar */}
          <Sidebar
            isCollapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
            onNavigateHome={() => {
              setSelectedModule(null);
              setSelectedModuleIndex(null);
              setSelectedSubFunction(null);
            }}
            onNavigateToModule={(index) => {
              setSelectedModule(adminModules[index]);
              setSelectedModuleIndex(index);
              setSelectedSubFunction(null);
            }}
            currentModuleIndex={selectedModuleIndex}
          />

          {/* Top Bar */}
          <TopBar sidebarCollapsed={sidebarCollapsed} currentModule={selectedSubFunction} />

          {/* Main Content Area */}
          <main
            className={`pt-16 transition-all duration-300 ${
              sidebarCollapsed ? 'ml-16' : 'ml-64'
            }`}
          >
            <SubFunctionRouter
              moduleTitle={selectedModule.title}
              subFunctionName={selectedSubFunction}
              onBack={() => setSelectedSubFunction(null)}
            />
          </main>
        </div>
      );
    }

    // 显示模块详情页
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Sidebar */}
        <Sidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onNavigateHome={() => {
            setSelectedModule(null);
            setSelectedModuleIndex(null);
            setSelectedSubFunction(null);
          }}
          onNavigateToModule={(index) => {
            setSelectedModule(adminModules[index]);
            setSelectedModuleIndex(index);
            setSelectedSubFunction(null);
          }}
          currentModuleIndex={selectedModuleIndex}
        />

        {/* Top Bar */}
        <TopBar sidebarCollapsed={sidebarCollapsed} currentModule={selectedModule.title} />

        {/* Main Content Area */}
        <main
          className={`pt-16 transition-all duration-300 ${
            sidebarCollapsed ? 'ml-16' : 'ml-64'
          }`}
        >
          <ModuleDetailPage
            title={selectedModule.title}
            icon={selectedModule.icon}
            iconColor={selectedModule.iconColor}
            iconBgColor={selectedModule.iconBgColor}
            subFunctions={selectedModule.subFunctions}
            onBack={() => {
              setSelectedModule(null);
              setSelectedModuleIndex(null);
              setSelectedSubFunction(null);
            }}
            onSubFunctionClick={(subFunctionName) => {
              setSelectedSubFunction(subFunctionName);
            }}
          />
        </main>
      </div>
    );
  }

  // 默认显示工作台
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar
        isCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onNavigateHome={() => {
          setSelectedModule(null);
          setSelectedModuleIndex(null);
        }}
        onNavigateToModule={(index) => {
          setSelectedModule(adminModules[index]);
          setSelectedModuleIndex(index);
        }}
        currentModuleIndex={selectedModuleIndex}
      />

      {/* Top Bar */}
      <TopBar sidebarCollapsed={sidebarCollapsed} currentModule="管理员工作台" />

      {/* Main Content Area */}
      <main
        className={`pt-16 transition-all duration-300 ${
          sidebarCollapsed ? 'ml-16' : 'ml-64'
        }`}
      >
        <div className="p-6">
          {/* Stats Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6 max-w-6xl mx-auto">
            <DashboardCard
              title="总用户数"
              value={totalUsersText}
              icon={Users}
              iconColor="text-emerald-600"
              iconBgColor="bg-emerald-50"
            />
            <DashboardCard
              title="总医生数"
              value={totalDoctorsText}
              icon={Stethoscope}
              iconColor="text-cyan-600"
              iconBgColor="bg-cyan-50"
            />
            <DashboardCard
              title="医院总数"
              value={totalHospitalsText}
              icon={Building2}
              iconColor="text-blue-600"
              iconBgColor="bg-blue-50"
            />
            <DashboardCard
              title="健康内容总数"
              value={totalArticlesText}
              icon={FileText}
              iconColor="text-violet-600"
              iconBgColor="bg-violet-50"
            />
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6 items-stretch">
            <AdminStatisticsChart data={trendData} loading={dashboardLoading} />
            <SystemActivityChart data={activityData} loading={dashboardLoading} />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;