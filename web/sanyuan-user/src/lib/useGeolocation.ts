import { useCallback, useState } from 'react';

export type GeolocationUiStatus =
  | 'idle'
  | 'requesting'
  | 'denied'
  | 'unavailable'
  | 'error'
  | 'ok';

type GeolocationOptions = {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
};

/**
 * 使用浏览器 Geolocation API 获取当前位置（需用户授权，建议在按钮点击中调用 request）。
 */
export function useGeolocation(opts?: GeolocationOptions) {
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [status, setStatus] = useState<GeolocationUiStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const request = useCallback(() => {
    setErrorMessage(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      setErrorMessage('当前环境不支持定位');
      return;
    }
    setStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setAccuracyM(
          typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : null,
        );
        setStatus('ok');
      },
      (err) => {
        setLatitude(null);
        setLongitude(null);
        setAccuracyM(null);
        if (err.code === 1) {
          setStatus('denied');
          setErrorMessage('您已拒绝位置权限，可稍后在浏览器设置中开启');
        } else if (err.code === 2) {
          setStatus('error');
          setErrorMessage('暂时无法获取位置');
        } else if (err.code === 3) {
          setStatus('error');
          setErrorMessage('定位超时，请重试');
        } else {
          setStatus('error');
          setErrorMessage(err.message || '定位失败');
        }
      },
      {
        enableHighAccuracy: opts?.enableHighAccuracy ?? false,
        timeout: opts?.timeout ?? 20000,
        maximumAge: opts?.maximumAge ?? 120000,
      },
    );
  }, [opts?.enableHighAccuracy, opts?.timeout, opts?.maximumAge]);

  return {
    latitude,
    longitude,
    accuracyM,
    status,
    errorMessage,
    request,
    hasFix: status === 'ok' && latitude != null && longitude != null,
  };
}
