'use client';

import React from 'react';
import {
  CaretRightOutlined,
  FullscreenExitOutlined,
  LeftOutlined,
  PauseOutlined,
  RightOutlined,
} from '@ant-design/icons';
import {
  CAROUSEL_FULLSCREEN_CHROME,
  resolveCarouselFullscreenProgress,
  type FullscreenSlideProgressInput,
} from '@/app/ops-analysis/utils/carouselFullscreenChrome';

const chromeVars = {
  '--carousel-fs-surface': CAROUSEL_FULLSCREEN_CHROME.surface,
  '--carousel-fs-border': CAROUSEL_FULLSCREEN_CHROME.border,
  '--carousel-fs-ink': CAROUSEL_FULLSCREEN_CHROME.ink,
  '--carousel-fs-play-surface': CAROUSEL_FULLSCREEN_CHROME.playSurface,
  '--carousel-fs-play-ink': CAROUSEL_FULLSCREEN_CHROME.playInk,
  '--carousel-fs-track': CAROUSEL_FULLSCREEN_CHROME.track,
  '--carousel-fs-played': CAROUSEL_FULLSCREEN_CHROME.played,
  '--carousel-fs-upcoming': CAROUSEL_FULLSCREEN_CHROME.upcoming,
  '--carousel-fs-shade': CAROUSEL_FULLSCREEN_CHROME.shade,
  '--carousel-fs-text-shadow': CAROUSEL_FULLSCREEN_CHROME.textShadow,
} as React.CSSProperties;

const capsuleClassName = 'border border-(--carousel-fs-border) bg-(--carousel-fs-surface) text-(--carousel-fs-ink) backdrop-blur-[12px] [text-shadow:var(--carousel-fs-text-shadow)]';

export interface CarouselFullscreenChromeProps {
  visible: boolean;
  paused: boolean;
  slides: readonly FullscreenSlideProgressInput[];
  index: number;
  remainingMs: number;
  positionLabel: string;
  canvasName: string;
  remainingLabel: string;
  pausedLabel: string;
  previousLabel: string;
  nextLabel: string;
  playLabel: string;
  pauseLabel: string;
  exitLabel: string;
  disableStep: boolean;
  disablePlay: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onExit: () => void;
  onHoverChange: (hovering: boolean) => void;
}

const stepButtonClassName = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-(--carousel-fs-ink) transition-opacity disabled:cursor-not-allowed disabled:opacity-40';

const CarouselFullscreenChrome: React.FC<CarouselFullscreenChromeProps> = ({
  visible,
  paused,
  slides,
  index,
  remainingMs,
  positionLabel,
  canvasName,
  remainingLabel,
  pausedLabel,
  previousLabel,
  nextLabel,
  playLabel,
  pauseLabel,
  exitLabel,
  disableStep,
  disablePlay,
  onPrevious,
  onNext,
  onTogglePlay,
  onExit,
  onHoverChange,
}) => {
  const progress = resolveCarouselFullscreenProgress({
    slides,
    index,
    remainingMs,
    paused,
  });
  const controlsClassName = visible
    ? 'pointer-events-auto translate-y-0 opacity-100'
    : 'pointer-events-none translate-y-2 opacity-0';

  return (
    <div className="pointer-events-none absolute inset-0 z-20" style={chromeVars}>
      <div
        className={`absolute left-1/2 top-6 -translate-x-1/2 rounded-[16px] px-4 py-2 text-sm transition-opacity duration-300 ${capsuleClassName} ${
          paused ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden={!paused}
        data-testid="carousel-fullscreen-paused-hint"
      >
        {pausedLabel}
      </div>
      <div
        className={`absolute inset-x-0 bottom-0 h-[120px] bg-gradient-to-t from-(--carousel-fs-shade) to-transparent transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden
      />
      <div
        className={`absolute bottom-6 left-1/2 flex w-max max-w-[min(960px,calc(100%-48px))] -translate-x-1/2 items-center gap-3 rounded-[16px] px-3 py-2 transition-[opacity,translate] duration-300 ${capsuleClassName} ${controlsClassName}`}
        data-testid="carousel-fullscreen-controls"
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
      >
        <button
          type="button"
          className={`${stepButtonClassName} cursor-pointer`}
          aria-label={previousLabel}
          disabled={disableStep}
          onClick={onPrevious}
        >
          <LeftOutlined style={{ fontSize: 16 }} />
        </button>
        <button
          type="button"
          className="inline-flex h-[52px] w-[52px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-(--carousel-fs-play-surface) p-0 text-(--carousel-fs-play-ink) [text-shadow:none] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={paused ? playLabel : pauseLabel}
          disabled={disablePlay}
          onClick={onTogglePlay}
        >
          {paused
            ? <CaretRightOutlined style={{ fontSize: 22 }} />
            : <PauseOutlined style={{ fontSize: 20 }} />}
        </button>
        <button
          type="button"
          className={`${stepButtonClassName} cursor-pointer`}
          aria-label={nextLabel}
          disabled={disableStep}
          onClick={onNext}
        >
          <RightOutlined style={{ fontSize: 16 }} />
        </button>
        <p className="m-0 flex min-w-0 items-baseline text-[17px] leading-none">
          <span className="shrink-0 tabular-nums">{positionLabel}</span>
          {canvasName ? (
            <span className="min-w-0 max-w-[420px] truncate" title={canvasName}>
              <span className="px-2 opacity-70">·</span>
              {canvasName}
            </span>
          ) : null}
        </p>
        <span className="shrink-0 text-sm tabular-nums">{remainingLabel}</span>
        <button
          type="button"
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-2 text-(--carousel-fs-ink)"
          aria-label={exitLabel}
          onClick={onExit}
        >
          <FullscreenExitOutlined style={{ fontSize: 16 }} />
          <span className="text-xs tracking-wide opacity-80">Esc</span>
        </button>
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-1 bg-(--carousel-fs-track)"
        data-testid="carousel-fullscreen-progress"
        data-progress-mode={progress.mode}
        data-current-color={progress.currentColor}
        aria-hidden
      >
        {progress.mode === 'segments' ? (
          <div className="flex h-full gap-0.5">
            {progress.segments.map((segment, segmentIndex) => (
              <div
                key={segmentIndex}
                className={`relative h-full min-w-0 flex-1 overflow-hidden ${
                  segment.tone === 'unavailable'
                    ? 'bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.28)_0_3px,rgba(255,255,255,0.08)_3px_7px)]'
                    : 'bg-(--carousel-fs-upcoming)'
                }`}
                data-tone={segment.tone}
                data-fill={segment.fill}
              >
                {segment.tone === 'played' || segment.tone === 'current' ? (
                  <div
                    className="absolute inset-y-0 left-0 w-full origin-left transition-transform duration-200 ease-linear"
                    style={{
                      transform: `scaleX(${segment.fill})`,
                      backgroundColor: segment.tone === 'played'
                        ? CAROUSEL_FULLSCREEN_CHROME.played
                        : progress.currentColor,
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div
            className="h-full w-full origin-left transition-transform duration-200 ease-linear"
            data-fill={progress.continuous}
            style={{
              transform: `scaleX(${progress.continuous})`,
              backgroundColor: progress.currentColor,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default CarouselFullscreenChrome;
