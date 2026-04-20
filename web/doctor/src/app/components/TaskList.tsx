import React from 'react';
import { LucideIcon, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  time?: string;
}

interface TaskListProps {
  title: string;
  tasks: Task[];
  icon?: LucideIcon;
}

export function TaskList({ title, tasks, icon: Icon }: TaskListProps) {
  const getPriorityConfig = (priority: string) => {
    const configs = {
      high: {
        icon: AlertCircle,
        color: 'text-red-600',
        bg: 'bg-red-50',
        border: 'border-red-200',
      },
      medium: {
        icon: Clock,
        color: 'text-orange-600',
        bg: 'bg-orange-50',
        border: 'border-orange-200',
      },
      low: {
        icon: CheckCircle2,
        color: 'text-teal-600',
        bg: 'bg-teal-50',
        border: 'border-teal-200',
      },
    };
    return configs[priority as keyof typeof configs] || configs.medium;
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-gray-700" />}
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        <span className="text-sm font-medium text-gray-500">
          {tasks.length} 项
        </span>
      </div>

      <div className="space-y-3">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm">暂无待处理事项</p>
          </div>
        ) : (
          tasks.map((task) => {
            const config = getPriorityConfig(task.priority);
            const PriorityIcon = config.icon;

            return (
              <div
                key={task.id}
                className={`p-4 rounded-lg border ${config.border} ${config.bg} hover:shadow-sm transition-shadow cursor-pointer`}
              >
                <div className="flex items-start gap-3">
                  <div className={`${config.color} mt-0.5`}>
                    <PriorityIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-sm font-medium text-gray-900 truncate">
                        {task.title}
                      </h4>
                      {task.time && (
                        <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                          {task.time}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-2">
                      {task.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
