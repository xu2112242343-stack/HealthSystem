import { useState, useEffect, useCallback, type DependencyList } from 'react';

/**
 * 异步数据加载：loading / error / data，支持 reload。
 * factory 应稳定或由 deps 驱动（勿在 render 内每次新建闭包却不列入 deps）。
 */
export function useAsyncData<T>(
  factory: () => Promise<T>,
  deps: DependencyList,
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void factory()
      .then((v) => {
        if (!cancelled) setData(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, reload };
}
