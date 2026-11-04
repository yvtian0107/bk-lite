'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasType } from '@/app/ops-analysis/constants/canvasTypes';
import {
  createCarouselPlayerState,
  isCarouselBusinessFailure,
  isCarouselSessionFailure,
  reduceCarouselLoad,
  reduceCarouselPlayer,
  type CarouselPlayerAction,
  type CarouselPlayerState,
  type CarouselSlideInput,
} from '@/app/ops-analysis/utils/carouselPlayer';

export const CAROUSEL_PLAYBACK_TICK_MS = 250;
export const CAROUSEL_PREFETCH_LEAD_MS = 2000;

export interface CarouselPlaybackSlide {
  key: string;
  available: boolean;
  dwellSeconds: number;
  resourceType: CanvasType;
  canvasId: number;
}

export type CarouselEnterOutcome =
  | { status: 'ok'; detail: unknown }
  | { status: 'skip' }
  | { status: 'ignore' };

const toInput = (slide: CarouselPlaybackSlide): CarouselSlideInput => ({
  key: slide.key,
  available: slide.available,
  dwellSeconds: slide.dwellSeconds,
});

const isAborted = (error: unknown, signal: AbortSignal): boolean => {
  if (signal.aborted) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = 'name' in error ? String((error as { name?: unknown }).name) : '';
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  return name === 'AbortError' || name === 'CanceledError' || code === 'ERR_CANCELED';
};

const oneAttempt = async (
  loadDetail: (slide: CarouselPlaybackSlide, signal: AbortSignal) => Promise<unknown>,
  slide: CarouselPlaybackSlide,
  signal: AbortSignal,
): Promise<CarouselEnterOutcome | { status: 'retry' }> => {
  try {
    return { status: 'ok', detail: await loadDetail(slide, signal) };
  } catch (error) {
    if (isAborted(error, signal) || isCarouselSessionFailure(error)) {
      return { status: 'ignore' };
    }
    if (isCarouselBusinessFailure(error)) {
      return { status: 'skip' };
    }
    return { status: 'retry' };
  }
};

/** 切入确认：403/404 立即跳过，瞬时错误再试一次，401 与取消都不记失败。 */
export const confirmCarouselEnter = async (
  loadDetail: (slide: CarouselPlaybackSlide, signal: AbortSignal) => Promise<unknown>,
  slide: CarouselPlaybackSlide,
  signal: AbortSignal,
): Promise<CarouselEnterOutcome> => {
  const first = await oneAttempt(loadDetail, slide, signal);
  if (first.status !== 'retry') {
    return first;
  }
  const second = await oneAttempt(loadDetail, slide, signal);
  return second.status === 'retry' ? { status: 'skip' } : second;
};

/** 当前项的 key 或可用性变了、或播放列表被整表重载时，才重新确认。重排和停留秒数只改计时。 */
export const carouselPlaybackNeedsReset = (
  previous: { resetKey: string; key?: string; available?: boolean },
  next: { resetKey: string; slides: readonly { key: string; available: boolean }[] },
): boolean => {
  if (previous.resetKey !== next.resetKey || !previous.key) {
    return true;
  }
  const slide = next.slides.find((item) => item.key === previous.key);
  if (!slide) {
    return true;
  }
  return slide.available !== previous.available;
};

const nextSlide = (
  slides: readonly CarouselPlaybackSlide[],
  player: CarouselPlayerState,
): CarouselPlaybackSlide | undefined => {
  const upcoming = player.slides.findIndex((slide, index) => (
    slide.available && index !== player.index && index > player.index
  ));
  const fallback = player.slides.findIndex((slide, index) => slide.available && index !== player.index);
  const target = upcoming >= 0 ? upcoming : fallback;
  if (target < 0) {
    return undefined;
  }
  const key = player.slides[target]?.key;
  return slides.find((slide) => slide.key === key);
};

export const useCarouselPlaybackSession = ({
  slides,
  enabled,
  loadDetail,
  resetKey = '',
  startPaused = false,
  confirmWhilePaused = false,
  retainUnavailable = false,
}: {
  slides: readonly CarouselPlaybackSlide[];
  enabled: boolean;
  loadDetail: (slide: CarouselPlaybackSlide, signal: AbortSignal) => Promise<unknown>;
  /** 播放列表重新拉取（切换轮播或组织）时递增，强制重新确认当前画布。 */
  resetKey?: string;
  /** 配置页预览默认暂停。播放页不传，仍进入即播放。 */
  startPaused?: boolean;
  /** 暂停时也确认当前画布，供预览加载。播放页不传，暂停仍会取消确认。 */
  confirmWhilePaused?: boolean;
  /** 刷新列表时，当前项即使失效也留在原位。播放页不传。 */
  retainUnavailable?: boolean;
}) => {
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const loadRef = useRef(loadDetail);
  loadRef.current = loadDetail;
  const playlistSignature = `${resetKey}|${slides.map((slide) => `${slide.key}:${Number(slide.available)}:${slide.dwellSeconds}`).join('|')}`;
  const signatureRef = useRef<string | null>(null);
  const resetKeyRef = useRef<string | null>(null);
  const [player, setPlayer] = useState<CarouselPlayerState>(() => {
    const created = createCarouselPlayerState(slides.map(toInput));
    return startPaused ? { ...created, paused: true } : created;
  });
  const [confirming, setConfirming] = useState(false);
  const [armedVisit, setArmedVisit] = useState<number | null>(null);
  const [initialDetail, setInitialDetail] = useState<unknown>(undefined);
  const confirmingRef = useRef(false);
  const armedVisitRef = useRef<number | null>(null);
  const prefetchDone = useRef<string | null>(null);
  const playerRef = useRef(player);
  playerRef.current = player;

  const disarm = () => {
    armedVisitRef.current = null;
    setArmedVisit(null);
    setInitialDetail(undefined);
  };

  useEffect(() => {
    if (signatureRef.current === playlistSignature) {
      return;
    }
    const isFirst = signatureRef.current === null;
    signatureRef.current = playlistSignature;
    if (isFirst) {
      resetKeyRef.current = resetKey;
      return;
    }
    const previous = playerRef.current;
    const previousSlide = previous.index >= 0 ? previous.slides[previous.index] : undefined;
    const nextSlides = slidesRef.current;
    const needsReset = carouselPlaybackNeedsReset(
      {
        resetKey: resetKeyRef.current ?? '',
        key: previousSlide?.key,
        available: previousSlide?.available,
      },
      { resetKey, slides: nextSlides },
    );
    resetKeyRef.current = resetKey;
    if (!needsReset) {
      setPlayer((current) => reduceCarouselPlayer(current, {
        type: 'syncSlides',
        slides: nextSlides.map(toInput),
      }));
      return;
    }
    disarm();
    confirmingRef.current = false;
    setConfirming(false);
    setPlayer((current) => reduceCarouselPlayer(current, {
      type: 'reset',
      slides: nextSlides.map(toInput),
      preferKey: current.slides[current.index]?.key ?? null,
      retainUnavailable,
    }));
  }, [playlistSignature, resetKey, retainUnavailable]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setPlayer((current) => {
        if (confirmingRef.current) {
          return current;
        }
        if (current.index >= 0 && armedVisitRef.current !== current.visit) {
          return current;
        }
        return reduceCarouselPlayer(current, { type: 'tick', deltaMs: CAROUSEL_PLAYBACK_TICK_MS });
      });
    }, CAROUSEL_PLAYBACK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const current = player.index >= 0 ? player.slides[player.index] : undefined;
  useEffect(() => {
    if (!enabled || !current?.available || player.holdMs > 0) {
      return undefined;
    }
    if ((!confirmWhilePaused && player.paused) || armedVisitRef.current === player.visit) {
      return undefined;
    }
    const slide = slidesRef.current.find((item) => item.key === current.key);
    if (!slide) {
      return undefined;
    }
    const visit = player.visit;
    const controller = new AbortController();
    let active = true;
    confirmingRef.current = true;
    setConfirming(true);
    setInitialDetail(undefined);
    void confirmCarouselEnter(
      (target, signal) => loadRef.current(target, signal),
      slide,
      controller.signal,
    ).then((result) => {
      if (!active) {
        return;
      }
      confirmingRef.current = false;
      setConfirming(false);
      if (result.status === 'ok') {
        armedVisitRef.current = visit;
        setArmedVisit(visit);
        setInitialDetail(result.detail);
        return;
      }
      if (result.status === 'skip') {
        setPlayer((state) => reduceCarouselLoad(state, {
          key: slide.key,
          phase: 'enter',
          ok: false,
          business: true,
        }));
      }
    });
    return () => {
      active = false;
      controller.abort();
      confirmingRef.current = false;
      setConfirming(false);
    };
  }, [
    confirmWhilePaused,
    current?.available,
    current?.key,
    enabled,
    player.holdMs,
    confirmWhilePaused ? false : player.paused,
    player.visit,
  ]);

  const lead = Boolean(current) && !player.paused && player.holdMs <= 0 && armedVisit === player.visit
    && player.remainingMs <= CAROUSEL_PREFETCH_LEAD_MS;
  useEffect(() => {
    if (!lead || player.index < 0) {
      return undefined;
    }
    const slide = nextSlide(slidesRef.current, playerRef.current);
    if (!slide) {
      return undefined;
    }
    const mark = `${player.visit}:${slide.key}`;
    const done = prefetchDone.current;
    if (done === mark) {
      return undefined;
    }
    const controller = new AbortController();
    let settled = false;
    void loadRef.current(slide, controller.signal).then(() => {
      settled = true;
      if (!controller.signal.aborted) {
        prefetchDone.current = mark;
      }
    }).catch((error) => {
      if (controller.signal.aborted || isAborted(error, controller.signal)) {
        return;
      }
      settled = true;
      prefetchDone.current = mark;
      if (isCarouselBusinessFailure(error)) {
        setPlayer((state) => reduceCarouselLoad(state, {
          key: slide.key,
          phase: 'prefetch',
          ok: false,
          business: true,
        }));
      }
    });
    return () => {
      controller.abort();
      if (!settled) {
        prefetchDone.current = null;
      }
    };
  }, [lead, player.index, player.visit]);

  const dispatch = useCallback((action: Exclude<CarouselPlayerAction, { type: 'tick' } | { type: 'reset' }>) => {
    setPlayer((currentState) => reduceCarouselPlayer(currentState, action));
  }, []);

  const ready = !confirming && player.index >= 0 && armedVisit === player.visit;

  return {
    player,
    confirming,
    ready,
    dispatch,
    initialDetail: ready ? initialDetail : undefined,
  };
};
