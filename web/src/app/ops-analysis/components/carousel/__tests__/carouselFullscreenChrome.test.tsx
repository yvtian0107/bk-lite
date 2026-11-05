import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CarouselFullscreenChrome from '@/app/ops-analysis/components/carousel/carouselFullscreenChrome';
import { CAROUSEL_FULLSCREEN_CHROME } from '@/app/ops-analysis/utils/carouselFullscreenChrome';

afterEach(cleanup);

const slides = (count: number) => (
  Array.from({ length: count }, () => ({ available: true, dwellSeconds: 30 }))
);

const renderChrome = (
  overrides: Partial<React.ComponentProps<typeof CarouselFullscreenChrome>> = {},
) => {
  const onHoverChange = vi.fn();
  render(
    <CarouselFullscreenChrome
      visible
      paused={false}
      slides={slides(3)}
      index={1}
      remainingMs={15_000}
      positionLabel="2 / 3"
      canvasName="机房总览"
      remainingLabel="剩余 15 秒"
      pausedLabel="已暂停 · 按空格继续"
      previousLabel="上一张"
      nextLabel="下一张"
      playLabel="播放"
      pauseLabel="暂停"
      exitLabel="退出全屏（Esc）"
      disableStep={false}
      disablePlay={false}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onTogglePlay={vi.fn()}
      onExit={vi.fn()}
      onHoverChange={onHoverChange}
      {...overrides}
    />,
  );
  return { onHoverChange };
};

describe('carousel fullscreen chrome', () => {
  it('shows the canvas name and keeps the bar while the pointer is over it', () => {
    const { onHoverChange } = renderChrome();
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByText('机房总览')).toBeTruthy();
    expect(screen.getByText('剩余 15 秒')).toBeTruthy();
    const controls = screen.getByTestId('carousel-fullscreen-controls');
    fireEvent.mouseEnter(controls);
    fireEvent.mouseLeave(controls);
    expect(onHoverChange).toHaveBeenNthCalledWith(1, true);
    expect(onHoverChange).toHaveBeenNthCalledWith(2, false);
    expect(screen.getByTestId('carousel-fullscreen-paused-hint').getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the hold message and leaves the progress empty', () => {
    renderChrome({
      slides: [
        { available: false, dwellSeconds: 30 },
        { available: false, dwellSeconds: 30 },
        { available: false, dwellSeconds: 30 },
      ],
      index: -1,
      remainingMs: 0,
      positionLabel: '暂无可播放的画布',
      canvasName: '',
      remainingLabel: '10 秒后重试',
    });
    expect(screen.getByText('暂无可播放的画布')).toBeTruthy();
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
    expect(screen.getByText('10 秒后重试')).toBeTruthy();
    expect(screen.queryByText('剩余 0 秒')).toBeNull();
    const progress = screen.getByTestId('carousel-fullscreen-progress');
    expect(progress.querySelector('[data-tone="current"]')).toBeNull();
    expect(progress.querySelectorAll('[data-tone="unavailable"]')).toHaveLength(3);
    expect(Array.from(progress.querySelectorAll('[data-fill]')).map((node) => node.getAttribute('data-fill'))).toEqual(['0', '0', '0']);
  });

  it('omits the canvas name when the slide is unavailable and switches the progress at 20', () => {
    const { rerender } = render(
      <CarouselFullscreenChrome
        visible
        paused={false}
        slides={slides(20)}
        index={0}
        remainingMs={30_000}
        positionLabel="1 / 20"
        canvasName=""
        remainingLabel="剩余 30 秒"
        pausedLabel="已暂停 · 按空格继续"
        previousLabel="上一张"
        nextLabel="下一张"
        playLabel="播放"
        pauseLabel="暂停"
        exitLabel="退出全屏（Esc）"
        disableStep={false}
        disablePlay={false}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onTogglePlay={vi.fn()}
        onExit={vi.fn()}
        onHoverChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('机房总览')).toBeNull();
    const progress = screen.getByTestId('carousel-fullscreen-progress');
    expect(progress.getAttribute('data-progress-mode')).toBe('segments');
    expect(progress.querySelectorAll('[data-tone]')).toHaveLength(20);
    expect(progress.getAttribute('data-current-color')).toBe(CAROUSEL_FULLSCREEN_CHROME.current);

    rerender(
      <CarouselFullscreenChrome
        visible={false}
        paused
        slides={slides(21)}
        index={0}
        remainingMs={30_000}
        positionLabel="1 / 21"
        canvasName=""
        remainingLabel="剩余 30 秒"
        pausedLabel="已暂停 · 按空格继续"
        previousLabel="上一张"
        nextLabel="下一张"
        playLabel="播放"
        pauseLabel="暂停"
        exitLabel="退出全屏（Esc）"
        disableStep={false}
        disablePlay={false}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onTogglePlay={vi.fn()}
        onExit={vi.fn()}
        onHoverChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('carousel-fullscreen-progress').getAttribute('data-progress-mode')).toBe('continuous');
    expect(screen.getByTestId('carousel-fullscreen-progress').getAttribute('data-current-color')).toBe(CAROUSEL_FULLSCREEN_CHROME.paused);
    expect(screen.getByTestId('carousel-fullscreen-paused-hint').getAttribute('aria-hidden')).toBe('false');
    expect(screen.getByText('已暂停 · 按空格继续')).toBeTruthy();
    expect(screen.getByTestId('carousel-fullscreen-controls').className).toContain('pointer-events-none');
  });
});
