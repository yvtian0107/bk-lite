/** 全屏播放条固定用这套颜色，保证盖在浅色或深色画布上都清楚，不跟控制台主题走。 */
export const CAROUSEL_FULLSCREEN_CHROME = {
  surface: 'rgba(16, 20, 30, 0.72)',
  border: 'rgba(255, 255, 255, 0.14)',
  ink: '#ffffff',
  playSurface: '#ffffff',
  playInk: '#10141e',
  track: 'rgba(8, 12, 20, 0.55)',
  played: '#ffffff',
  upcoming: 'rgba(255, 255, 255, 0.18)',
  current: '#155AEF',
  paused: '#FAAD14',
  shade: 'rgba(0, 0, 0, 0.35)',
  textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)',
} as const;

export const CAROUSEL_FULLSCREEN_CONTROLS_IDLE_MS = 3000;
/** 画布数不超过这个值时进度条分段，再多就合成一条。 */
export const CAROUSEL_FULLSCREEN_SEGMENT_MAX = 20;

export interface FullscreenControlIdlePlan {
  visible: boolean;
  armIdleTimer: boolean;
}

export interface FullscreenSlideProgressInput {
  available: boolean;
  dwellSeconds: number;
}

export type FullscreenSegmentTone = 'played' | 'current' | 'upcoming' | 'unavailable';

export interface FullscreenSegment {
  tone: FullscreenSegmentTone;
  /** 0–1。已播为 1，当前段为已消耗停留占比，其余为 0。 */
  fill: number;
}

export interface FullscreenProgressModel {
  mode: 'segments' | 'continuous';
  segments: FullscreenSegment[];
  /** 按序号加当前段进度，范围 0–1。 */
  continuous: number;
  currentColor: string;
}

const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

/** 暂停，或指针停在控制条上时，不启动隐藏计时。 */
export const planFullscreenControlIdle = (
  reason: 'show' | 'idle',
  flags: { paused: boolean; hoveringControls: boolean },
): FullscreenControlIdlePlan => {
  const pinned = flags.paused || flags.hoveringControls;
  if (reason === 'idle') {
    return { visible: pinned, armIdleTimer: false };
  }
  return { visible: true, armIdleTimer: !pinned };
};

export const fullscreenStageCursor = (
  stageFullscreen: boolean,
  controlsVisible: boolean,
): 'auto' | 'none' => (
  stageFullscreen && !controlsVisible ? 'none' : 'auto'
);

export const carouselRemainingWholeSeconds = (remainingMs: number): number => {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
};

export const carouselDwellFill = (dwellSeconds: number, remainingMs: number): number => {
  const dwellMs = Math.max(1, dwellSeconds) * 1000;
  return clampUnit((dwellMs - remainingMs) / dwellMs);
};

export const resolveCarouselFullscreenProgress = (input: {
  slides: readonly FullscreenSlideProgressInput[];
  index: number;
  remainingMs: number;
  paused: boolean;
}): FullscreenProgressModel => {
  const count = input.slides.length;
  const index = input.index < 0 || count === 0
    ? -1
    : Math.min(input.index, count - 1);
  const current = index >= 0 ? input.slides[index] : undefined;
  const currentFill = current?.available
    ? carouselDwellFill(current.dwellSeconds, input.remainingMs)
    : 0;
  const segments = input.slides.map((slide, slideIndex): FullscreenSegment => {
    if (!slide.available) return { tone: 'unavailable', fill: 0 };
    if (index < 0) return { tone: 'upcoming', fill: 0 };
    if (slideIndex < index) return { tone: 'played', fill: 1 };
    if (slideIndex === index) return { tone: 'current', fill: currentFill };
    return { tone: 'upcoming', fill: 0 };
  });
  const continuous = index < 0 || count === 0
    ? 0
    : clampUnit((index + currentFill) / count);
  return {
    mode: count > CAROUSEL_FULLSCREEN_SEGMENT_MAX ? 'continuous' : 'segments',
    segments,
    continuous,
    currentColor: input.paused
      ? CAROUSEL_FULLSCREEN_CHROME.paused
      : CAROUSEL_FULLSCREEN_CHROME.current,
  };
};
