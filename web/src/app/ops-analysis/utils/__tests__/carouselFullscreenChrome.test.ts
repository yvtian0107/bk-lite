import { describe, expect, it } from 'vitest';
import {
  CAROUSEL_FULLSCREEN_CHROME,
  CAROUSEL_FULLSCREEN_SEGMENT_MAX,
  carouselDwellFill,
  carouselRemainingWholeSeconds,
  fullscreenStageCursor,
  planFullscreenControlIdle,
  resolveCarouselFullscreenProgress,
} from '@/app/ops-analysis/utils/carouselFullscreenChrome';

const slides = (count: number, unavailableAt: number[] = []) => (
  Array.from({ length: count }, (_, index) => ({
    available: !unavailableAt.includes(index),
    dwellSeconds: 30,
  }))
);

describe('carousel fullscreen chrome', () => {
  it('splits progress into segments through 20 canvases and switches to one bar after that', () => {
    const atLimit = resolveCarouselFullscreenProgress({
      slides: slides(CAROUSEL_FULLSCREEN_SEGMENT_MAX),
      index: 2,
      remainingMs: 15_000,
      paused: false,
    });
    expect(atLimit.mode).toBe('segments');
    expect(atLimit.segments).toHaveLength(20);
    expect(atLimit.segments[0]).toEqual({ tone: 'played', fill: 1 });
    expect(atLimit.segments[1]).toEqual({ tone: 'played', fill: 1 });
    expect(atLimit.segments[2]).toEqual({ tone: 'current', fill: 0.5 });
    expect(atLimit.segments[3]).toEqual({ tone: 'upcoming', fill: 0 });
    expect(atLimit.currentColor).toBe(CAROUSEL_FULLSCREEN_CHROME.current);

    const continuous = resolveCarouselFullscreenProgress({
      slides: slides(CAROUSEL_FULLSCREEN_SEGMENT_MAX + 1),
      index: 2,
      remainingMs: 15_000,
      paused: false,
    });
    expect(continuous.mode).toBe('continuous');
    expect(continuous.continuous).toBeCloseTo(2.5 / 21);
  });

  it('marks unavailable canvases and freezes the current color while paused', () => {
    const playing = resolveCarouselFullscreenProgress({
      slides: slides(4, [1]),
      index: 2,
      remainingMs: 6_000,
      paused: false,
    });
    const paused = resolveCarouselFullscreenProgress({
      slides: slides(4, [1]),
      index: 2,
      remainingMs: 6_000,
      paused: true,
    });
    expect(playing.segments.map((segment) => segment.tone)).toEqual([
      'played',
      'unavailable',
      'current',
      'upcoming',
    ]);
    expect(playing.segments[2].fill).toBeCloseTo(carouselDwellFill(30, 6_000));
    expect(paused.segments[2].fill).toBe(playing.segments[2].fill);
    expect(paused.currentColor).toBe(CAROUSEL_FULLSCREEN_CHROME.paused);
    expect(paused.continuous).toBeCloseTo((2 + playing.segments[2].fill) / 4);
  });

  it('keeps the controls up while paused or hovered, and hides them after idle otherwise', () => {
    expect(planFullscreenControlIdle('show', { paused: false, hoveringControls: false })).toEqual({
      visible: true,
      armIdleTimer: true,
    });
    expect(planFullscreenControlIdle('idle', { paused: false, hoveringControls: false })).toEqual({
      visible: false,
      armIdleTimer: false,
    });
    expect(planFullscreenControlIdle('show', { paused: false, hoveringControls: true })).toEqual({
      visible: true,
      armIdleTimer: false,
    });
    expect(planFullscreenControlIdle('idle', { paused: false, hoveringControls: true })).toEqual({
      visible: true,
      armIdleTimer: false,
    });
    expect(planFullscreenControlIdle('show', { paused: true, hoveringControls: false })).toEqual({
      visible: true,
      armIdleTimer: false,
    });
    expect(planFullscreenControlIdle('idle', { paused: true, hoveringControls: false })).toEqual({
      visible: true,
      armIdleTimer: false,
    });
    expect(fullscreenStageCursor(true, false)).toBe('none');
    expect(fullscreenStageCursor(true, true)).toBe('auto');
    expect(fullscreenStageCursor(false, false)).toBe('auto');
    expect(carouselRemainingWholeSeconds(30_000)).toBe(30);
    expect(carouselRemainingWholeSeconds(1)).toBe(1);
    expect(carouselRemainingWholeSeconds(0)).toBe(0);
  });
});
