import { useCallback } from 'react';
import useApiClient from '@/utils/request';
import {
  readPlaybackCanvasDetail,
  usePlaybackCanvasDetailCache,
} from '@/app/ops-analysis/context/playbackCanvasDetail';

export const useDashBoardApi = () => {
  const { get, put } = useApiClient();
  const playbackCache = usePlaybackCanvasDetailCache();

  const getDashboardDetail = useCallback(async (id: string | number) => {
    const cached = readPlaybackCanvasDetail(playbackCache, 'dashboard', id);
    if (cached) {
      return cached;
    }
    return get(`/operation_analysis/api/dashboard/${id}/`);
  }, [get, playbackCache]);

  const saveDashboard = useCallback(async (id: string | number, data: any) => {
    return put(`/operation_analysis/api/dashboard/${id}/`, data);
  }, [put]);

  return {
    getDashboardDetail,
    saveDashboard,
  };
};
