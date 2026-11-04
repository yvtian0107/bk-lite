import { useCallback } from 'react';
import useApiClient from '@/utils/request';
import { useShareCanvasDetailOverride } from '@/app/ops-analysis/context/shareCanvasDetail';
import {
  readPlaybackCanvasDetail,
  usePlaybackCanvasDetailCache,
} from '@/app/ops-analysis/context/playbackCanvasDetail';

export const useScreenApi = () => {
  const { get, put, post, del } = useApiClient();
  const shareDetailOverride = useShareCanvasDetailOverride();
  const playbackCache = usePlaybackCanvasDetailCache();

  const getScreenDetail = useCallback(async (id: string | number) => {
    if (shareDetailOverride) {
      return shareDetailOverride();
    }
    const cached = readPlaybackCanvasDetail(playbackCache, 'screen', id);
    if (cached) {
      return cached;
    }
    return get(`/operation_analysis/api/screen/${id}/`);
  }, [get, playbackCache, shareDetailOverride]);

  const saveScreen = useCallback(async (id: string | number, data: any) => {
    return put(`/operation_analysis/api/screen/${id}/`, data);
  }, [put]);

  const createScreen = useCallback(async (data: any) => {
    return post('/operation_analysis/api/screen/', data);
  }, [post]);

  const deleteScreen = useCallback(async (id: string | number) => {
    return del(`/operation_analysis/api/screen/${id}/`);
  }, [del]);

  return {
    getScreenDetail,
    saveScreen,
    createScreen,
    deleteScreen,
  };
};
