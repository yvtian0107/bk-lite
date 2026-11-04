'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Spin } from 'antd';
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
  isCarouselHotkeyBlocked,
  isCarouselOverlayOpen,
  skippedCarouselCount,
} from '@/app/ops-analysis/utils/carouselPlayer';
import type { CarouselDetail } from '@/app/ops-analysis/types/carousel';
import { PlaybackSlideFrame, type PlaybackSlide } from './playbackCanvas';
import { useCarouselPlaybackSession } from './useCarouselPlaybackSession';

const IDLE_MS = 3000;

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
  const [detail, setDetail] = useState<CarouselDetail | null>(null);
  const [playlistNonce, setPlaylistNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const idleTimer = useRef<number | null>(null);

  const slides = useMemo(() => (detail ? toSlides(detail) : []), [detail]);
  const loadCanvas = useCallback((slide: PlaybackSlide, signal: AbortSignal) => (
    prefetchCanvasDetail(slide.resourceType, slide.canvasId, signal)
  ), [prefetchCanvasDetail]);
  const session = useCarouselPlaybackSession({
    slides,
    enabled: !loading && !failed && Boolean(detail),
    loadDetail: loadCanvas,
    resetKey: String(playlistNonce),
  });
  const player = session.player;

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
      setPlaylistNonce((current) => current + 1);
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

  const currentKey = player.index >= 0 ? player.slides[player.index]?.key : undefined;
  const currentSlide = currentKey ? slides.find((slide) => slide.key === currentKey) : undefined;
  const currentInput = player.slides[player.index];

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
        session.dispatch({ type: 'next' });
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showControls();
        session.dispatch({ type: 'prev' });
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        showControls();
        session.dispatch({ type: 'togglePause' });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [exitPlay, session.dispatch, showControls]);

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
          ) : !session.ready ? (
            <div className="flex h-full items-center justify-center">
              <Spin />
            </div>
          ) : (
            <PlaybackSlideFrame
              key={`${currentSlide.key}:${player.visit}`}
              slide={currentSlide}
              initialDetail={session.initialDetail}
              onError={() => session.dispatch({ type: 'markUnavailable', key: currentSlide.key })}
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
              onClick={() => session.dispatch({ type: 'prev' })}
            />
            <Button
              type="text"
              aria-label={player.paused ? t('opsCarousel.resume') : t('opsCarousel.pause')}
              icon={player.paused ? <CaretRightOutlined /> : <PauseOutlined />}
              onClick={() => session.dispatch({ type: 'togglePause' })}
            />
            <Button
              type="text"
              aria-label={t('opsCarousel.next')}
              icon={<RightOutlined />}
              onClick={() => session.dispatch({ type: 'next' })}
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
