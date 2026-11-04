'use client';

import { createContext, useContext } from 'react';

export type PlaybackDetailCache = Map<string, unknown>;

const PlaybackCanvasDetailContext = createContext<PlaybackDetailCache | null>(null);

export const PlaybackCanvasDetailProvider = PlaybackCanvasDetailContext.Provider;

export const playbackDetailKey = (resourceType: string, canvasId: string | number) =>
  `${resourceType}:${canvasId}`;

export const readPlaybackCanvasDetail = <T,>(
  cache: PlaybackDetailCache | null,
  resourceType: string,
  canvasId: string | number,
): T | undefined => {
  if (!cache) {
    return undefined;
  }
  const key = playbackDetailKey(resourceType, canvasId);
  const value = cache.get(key) as T | undefined;
  if (value !== undefined) {
    cache.delete(key);
  }
  return value;
};

export const usePlaybackCanvasDetailCache = () => useContext(PlaybackCanvasDetailContext);
