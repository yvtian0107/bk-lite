import { describe, expect, it } from 'vitest';
import {
  carouselHiddenGroupIds,
  clampCarouselDwellSeconds,
  createCarouselPlayerState,
  isCarouselHotkeyBlocked,
  reduceCarouselPlayer,
  skippedCarouselCount,
  type CarouselSlideInput,
} from '@/app/ops-analysis/utils/carouselPlayer';

const slides = (available: boolean[]): CarouselSlideInput[] =>
  available.map((isAvailable, index) => ({
    key: `s${index}`,
    available: isAvailable,
    dwellSeconds: index === 1 ? 10 : 30,
  }));

describe('carousel player', () => {
  it('starts on the first available slide and resolves dwell', () => {
    const state = createCarouselPlayerState(slides([false, true, true]));
    expect(state.index).toBe(1);
    expect(state.remainingMs).toBe(10_000);
    expect(skippedCarouselCount(state)).toBe(1);
    expect(clampCarouselDwellSeconds(4)).toBe(5);
    expect(clampCarouselDwellSeconds(301)).toBe(300);
    expect(clampCarouselDwellSeconds('nope')).toBe(30);
  });

  it('ticks down, pauses, and loops back to the first available slide', () => {
    let state = createCarouselPlayerState(slides([true, false, true]));
    state = reduceCarouselPlayer(state, { type: 'tick', deltaMs: 1000 });
    expect(state.index).toBe(0);
    expect(state.remainingMs).toBe(29_000);

    state = reduceCarouselPlayer(state, { type: 'togglePause' });
    const paused = reduceCarouselPlayer(state, { type: 'tick', deltaMs: 50_000 });
    expect(paused.index).toBe(0);
    expect(paused.remainingMs).toBe(29_000);

    state = reduceCarouselPlayer(paused, { type: 'togglePause' });
    state = reduceCarouselPlayer(state, { type: 'tick', deltaMs: 29_000 });
    expect(state.index).toBe(2);
    expect(state.remainingMs).toBe(30_000);

    state = reduceCarouselPlayer(state, { type: 'tick', deltaMs: 30_000 });
    expect(state.index).toBe(0);
    expect(state.visit).toBeGreaterThan(0);
  });

  it('manual next and previous skip unavailable slides and wrap', () => {
    let state = createCarouselPlayerState(slides([true, false, true]));
    state = reduceCarouselPlayer(state, { type: 'next' });
    expect(state.index).toBe(2);
    state = reduceCarouselPlayer(state, { type: 'next' });
    expect(state.index).toBe(0);
    state = reduceCarouselPlayer(state, { type: 'prev' });
    expect(state.index).toBe(2);
  });

  it('a single slide loops onto itself and a failed slide is skipped', () => {
    let state = createCarouselPlayerState(slides([true]));
    const looped = reduceCarouselPlayer(state, { type: 'next' });
    expect(looped.index).toBe(0);
    expect(looped.visit).toBe(state.visit + 1);
    expect(looped.remainingMs).toBe(30_000);

    state = createCarouselPlayerState(slides([true, true]));
    state = reduceCarouselPlayer(state, { type: 'markUnavailable', key: 's0' });
    expect(state.index).toBe(1);
    expect(skippedCarouselCount(state)).toBe(1);

    state = reduceCarouselPlayer(state, { type: 'markUnavailable', key: 's1' });
    expect(state.index).toBe(-1);
    expect(skippedCarouselCount(state)).toBe(2);
  });

  it('keeps the current slide when the playlist is refreshed', () => {
    const current = createCarouselPlayerState(slides([true, true]));
    const moved = reduceCarouselPlayer(current, { type: 'next' });
    const reset = reduceCarouselPlayer(moved, {
      type: 'reset',
      slides: slides([false, true]),
      preferKey: 's1',
    });
    expect(reset.index).toBe(1);
    expect(reset.paused).toBe(false);
  });

  it('compares canvas groups against the carousel groups', () => {
    expect(carouselHiddenGroupIds([1, 3], [1, 2, 3])).toEqual([2]);
    expect(carouselHiddenGroupIds([], [1])).toEqual([1]);
  });

  it('ignores hotkeys from inputs and open selectors', () => {
    const input = document.createElement('input');
    const button = document.createElement('button');
    const picker = document.createElement('div');
    picker.className = 'ant-select';
    const option = document.createElement('span');
    picker.append(option);
    expect(isCarouselHotkeyBlocked(input)).toBe(true);
    expect(isCarouselHotkeyBlocked(button)).toBe(false);
    expect(isCarouselHotkeyBlocked(option)).toBe(true);
  });
});
