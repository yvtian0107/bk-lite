'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty } from 'antd';
import {
  CaretRightOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  LeftOutlined,
  PauseOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/utils/i18n';
import { useUserInfoContext } from '@/context/userInfo';
import { useCarouselApi } from '@/app/ops-analysis/api/carousel';
import { buildOpsCarouselViewHref } from '@/app/ops-analysis/utils/carouselLinks';
import {
  createCarouselPlayerState,
  isCarouselBusinessFailure,
  isCarouselHotkeyBlocked,
  isCarouselOverlayOpen,
  reduceCarouselLoad,
  reduceCarouselPlayer,
  skippedCarouselCount,
  type CarouselPlayerState,
  type CarouselSlideInput,
} from '@/app/ops-analysis/utils/carouselPlayer';
import type { CarouselDetail } from '@/app/ops-analysis/types/carousel';
import { PlaybackSlideFrame, type PlaybackSlide } from './playbackCanvas';

const IDLE_MS = 3000;
const TICK_MS = 250;
const PREFETCH_LEAD_MS = 2000;

const toSlides = (detail: CarouselDetail): PlaybackSlide[] =>
  detail.items.map((item) => ({
    key: String(item.id),
    resourceType: item.resource_type,
    canvasId: item.canvas_id,
    name: item.canvas_name || '',
    dwellSeconds: item.resolved_dwell_seconds,
    available: item.available,
  }));

const PlayStage = ({ carouselId }: { carouselId: string }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { selectedGroup } = useUserInfoContext();
  const { getCarouselPlayback, prefetchCanvasDetail } = useCarouselApi();
  const rootRef = useRef<HTMLDivElement>(null);
  const prefetchedKey = useRef<string | null>(null);
  const [detail, setDetail] = useState<CarouselDetail | null>(null);
  const [player, setPlayer] = useState<CarouselPlayerState>(() => createCarouselPlayerState([]));
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [enterRetryKey, setEnterRetryKey] = useState<string | null>(null);
  const idleTimer = useRef<number | null>(null);
  const playerRef = useRef(player);
  playerRef.current = player;

  const slides = useMemo(() => (detail ? toSlides(detail) : []), [detail]);
  const slideByKey = useMemo(() => {
    const map = new Map<string, PlaybackSlide>();
    slides.forEach((slide) => map.set(slide.key, slide));
    return map;
  }, [slides]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimer.current != null) {
      window.clearTimeout(idleTimer.current);
    }
    idleTimer.current = window.setTimeout(() => setControlsVisible(false), IDLE_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void getCarouselPlayback(carouselId).then((payload) => {
      if (cancelled) return;
      setDetail(payload);
      setPlayer((current) => reduceCarouselPlayer(current, {
        type: 'reset',
        slides: toSlides(payload).map((slide) => ({
          key: slide.key,
          available: slide.available,
          dwellSeconds: slide.dwellSeconds,
        })),
        preferKey: current.slides[current.index]?.key ?? null,
      }));
    }).catch((error) => {
      console.error('Failed to load carousel playback:', error);
      if (!cancelled) setFailed(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [carouselId, getCarouselPlayback, selectedGroup?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPlayer((current) => reduceCarouselPlayer(current, { type: 'tick', deltaMs: TICK_MS }));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const currentSlide = player.index >= 0 ? slideByKey.get(player.slides[player.index]?.key) : undefined;
  const currentInput: CarouselSlideInput | undefined = player.slides[player.index];

  const leadPrefetch = Boolean(currentInput) && !player.paused && player.remainingMs <= PREFETCH_LEAD_MS;
  useEffect(() => {
    if (!leadPrefetch) return;
    const nextIndex = player.slides.findIndex((slide, index) => slide.available && index !== player.index && index > player.index);
    const fallback = player.slides.findIndex((slide, index) => slide.available && index !== player.index);
    const targetIndex = nextIndex >= 0 ? nextIndex : fallback;
    const target = targetIndex >= 0 ? player.slides[targetIndex] : undefined;
    const slide = target ? slideByKey.get(target.key) : undefined;
    if (!slide || prefetchedKey.current === `${player.visit}:${slide.key}`) return;
    prefetchedKey.current = `${player.visit}:${slide.key}`;
    let cancelled = false;
    void prefetchCanvasDetail(slide.resourceType, slide.canvasId).catch((error) => {
      if (cancelled) return;
      if (!isCarouselBusinessFailure(error)) {
        if (playerRef.current.slides[playerRef.current.index]?.key !== slide.key) {
          setEnterRetryKey(slide.key);
        }
        return;
      }
      setPlayer((current) => reduceCarouselLoad(current, {
        key: slide.key,
        phase: 'prefetch',
        ok: false,
        business: true,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [leadPrefetch, player.index, player.slides, player.visit, prefetchCanvasDetail, slideByKey]);

  const confirmingEnter = Boolean(currentSlide && enterRetryKey === currentSlide.key);
  useEffect(() => {
    if (!confirmingEnter || !currentSlide) return;
    let cancelled = false;
    void prefetchCanvasDetail(currentSlide.resourceType, currentSlide.canvasId).then(() => {
      if (!cancelled) setEnterRetryKey(null);
    }).catch((error) => {
      if (cancelled) return;
      setEnterRetryKey(null);
      setPlayer((current) => reduceCarouselLoad(current, {
        key: currentSlide.key,
        phase: 'enter',
        ok: false,
        business: isCarouselBusinessFailure(error),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [confirmingEnter, currentSlide, prefetchCanvasDetail]);

  const exitPlay = useCallback(() => {
    const href = buildOpsCarouselViewHref(carouselId);
    window.close();
    router.push(href);
  }, [carouselId, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCarouselHotkeyBlocked(event.target) || isCarouselOverlayOpen()) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen();
          return;
        }
        exitPlay();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        showControls();
        setPlayer((current) => reduceCarouselPlayer(current, { type: 'next' }));
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showControls();
        setPlayer((current) => reduceCarouselPlayer(current, { type: 'prev' }));
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        showControls();
        setPlayer((current) => reduceCarouselPlayer(current, { type: 'togglePause' }));
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [exitPlay, showControls]);

  useEffect(() => {
    const onFullscreen = () => setBrowserFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    showControls();
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (idleTimer.current != null) window.clearTimeout(idleTimer.current);
    };
  }, [showControls]);

  const skipped = skippedCarouselCount(player);
  const dwellMs = (currentInput?.dwellSeconds ?? 1) * 1000;
  const progress = currentInput ? Math.max(0, Math.min(1, player.remainingMs / dwellMs)) : 0;
  const positionLabel = currentInput
    ? `${player.slides.slice(0, player.index + 1).filter((slide) => slide.available).length} / ${player.slides.filter((slide) => slide.available).length}`
    : '';

  const toggleBrowserFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void rootRef.current?.requestFullscreen();
  };

  return (
      <div
        ref={rootRef}
        className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg-1)]"
        onMouseMove={showControls}
      >
        <div className="h-full w-full min-h-0">
          {loading ? null : failed || !detail ? (
            <div className="flex h-full items-center justify-center">
              <Empty description={t('opsCarousel.playFailed')} />
            </div>
          ) : !currentSlide ? (
            <div className="flex h-full items-center justify-center">
              <Empty description={t('opsCarousel.allUnavailable')} />
            </div>
          ) : confirmingEnter ? null : (
            <PlaybackSlideFrame
              key={`${currentSlide.key}:${player.visit}`}
              slide={currentSlide}
              onError={() => {
                setPlayer((current) => reduceCarouselLoad(current, {
                  key: currentSlide.key,
                  phase: 'enter',
                  ok: false,
                  business: false,
                }));
              }}
            />
          )}
        </div>
        {skipped > 0 && (
          <div className="pointer-events-none absolute right-4 top-4 z-20 rounded bg-[var(--color-fill-2)] px-2 py-1 text-xs text-[var(--color-text-2)]">
            {t('opsCarousel.skipped', undefined, { count: skipped })}
          </div>
        )}
        <div
          className={`absolute inset-x-0 bottom-0 z-20 bg-[color-mix(in_srgb,var(--color-bg-1)_88%,transparent)] px-4 py-3 transition-opacity ${
            controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="mb-2 h-1 overflow-hidden rounded bg-[var(--color-fill-3)]">
            <div className="h-full bg-[var(--color-primary)]" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex items-center gap-3 text-[var(--color-text-1)]">
            <Button
              type="text"
              aria-label={t('opsCarousel.previous')}
              icon={<LeftOutlined />}
              onClick={() => setPlayer((current) => reduceCarouselPlayer(current, { type: 'prev' }))}
            />
            <Button
              type="text"
              aria-label={player.paused ? t('opsCarousel.resume') : t('opsCarousel.pause')}
              icon={player.paused ? <CaretRightOutlined /> : <PauseOutlined />}
              onClick={() => setPlayer((current) => reduceCarouselPlayer(current, { type: 'togglePause' }))}
            />
            <Button
              type="text"
              aria-label={t('opsCarousel.next')}
              icon={<RightOutlined />}
              onClick={() => setPlayer((current) => reduceCarouselPlayer(current, { type: 'next' }))}
            />
            <span className="text-sm">{positionLabel}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{currentSlide?.name || detail?.name}</span>
            <span className="text-sm tabular-nums">{Math.ceil(player.remainingMs / 1000)}s</span>
            <Button
              type="text"
              aria-label={browserFullscreen ? t('common.exitFullscreen') : t('opsCarousel.browserFullscreen')}
              icon={browserFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={toggleBrowserFullscreen}
            />
          </div>
        </div>
      </div>
  );
};

export default PlayStage;
