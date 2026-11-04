import { useCallback } from 'react';
import useApiClient from '@/utils/request';
import { useShareCanvasDetailOverride } from '@/app/ops-analysis/context/shareCanvasDetail';
import {
  readPlaybackCanvasDetail,
  usePlaybackCanvasDetailCache,
} from '@/app/ops-analysis/context/playbackCanvasDetail';
import type {
  ReportDetail,
  SaveReportViewSetsInput,
} from '@/app/ops-analysis/types/report';

export const useReportApi = () => {
  const { get, patch, post, del } = useApiClient();
  const shareDetailOverride = useShareCanvasDetailOverride();
  const playbackCache = usePlaybackCanvasDetailCache();

  const getReportDetail = useCallback(async (
    id: string | number,
  ): Promise<ReportDetail> => {
    if (shareDetailOverride) {
      return (await shareDetailOverride()) as ReportDetail;
    }
    const cached = readPlaybackCanvasDetail<ReportDetail>(playbackCache, 'report', id);
    if (cached) {
      return cached;
    }
    return get<ReportDetail>(`/operation_analysis/api/report/${id}/`);
  }, [get, playbackCache, shareDetailOverride]);

  const saveReportViewSets = useCallback(
    async (id: string | number, data: SaveReportViewSetsInput) =>
      patch<ReportDetail>(`/operation_analysis/api/report/${id}/`, data),
    [patch],
  );

  const createReport = useCallback(async (data: Record<string, unknown>) => {
    return post<ReportDetail>('/operation_analysis/api/report/', data);
  }, [post]);

  const deleteReport = useCallback(async (id: string | number) => {
    return del(`/operation_analysis/api/report/${id}/`);
  }, [del]);

  return {
    getReportDetail,
    saveReportViewSets,
    createReport,
    deleteReport,
  };
};
