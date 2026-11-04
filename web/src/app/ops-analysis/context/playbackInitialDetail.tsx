'use client';

import { createContext, useContext } from 'react';
import type { CanvasType } from '@/app/ops-analysis/constants/canvasTypes';

export interface PlaybackInitialDetail {
  resourceType: CanvasType;
  canvasId: number;
  detail: unknown;
}

const PlaybackInitialDetailContext = createContext<PlaybackInitialDetail | null>(null);

export const PlaybackInitialDetailProvider = PlaybackInitialDetailContext.Provider;

export const usePlaybackInitialDetail = () => useContext(PlaybackInitialDetailContext);

export const readPlaybackInitialDetail = <T,>(
  seeded: PlaybackInitialDetail | null,
  resourceType: CanvasType,
  id: string | number,
): T | undefined => {
  if (!seeded || seeded.resourceType !== resourceType || String(seeded.canvasId) !== String(id)) {
    return undefined;
  }
  return seeded.detail as T;
};

/** 播放态优先用切入确认拿到的详情；没有注入时才请求。刷新周期不走这条详情请求。 */
export const loadPlaybackCanvasDetail = async <T,>(
  seeded: PlaybackInitialDetail | null,
  resourceType: CanvasType,
  id: string | number,
  fetchDetail: () => Promise<T>,
): Promise<T> => {
  const initial = readPlaybackInitialDetail<T>(seeded, resourceType, id);
  if (initial !== undefined) {
    return initial;
  }
  return fetchDetail();
};
