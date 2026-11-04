export const CAROUSEL_DWELL_MIN_SECONDS = 5;
export const CAROUSEL_DWELL_MAX_SECONDS = 300;
export const CAROUSEL_DEFAULT_DWELL_SECONDS = 30;
export const CAROUSEL_MAX_ITEMS = 50;

export interface CarouselSlideInput {
  key: string;
  available: boolean;
  dwellSeconds: number;
}

export interface CarouselPlayerState {
  slides: CarouselSlideInput[];
  index: number;
  paused: boolean;
  remainingMs: number;
  visit: number;
}

export type CarouselPlayerAction =
  | { type: 'reset'; slides: CarouselSlideInput[]; preferKey?: string | null }
  | { type: 'tick'; deltaMs: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'togglePause' }
  | { type: 'markUnavailable'; key: string };

export const clampCarouselDwellSeconds = (
  value: unknown,
  fallback = CAROUSEL_DEFAULT_DWELL_SECONDS,
): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(
    CAROUSEL_DWELL_MAX_SECONDS,
    Math.max(CAROUSEL_DWELL_MIN_SECONDS, Math.round(parsed)),
  );
};

export const carouselHiddenGroupIds = (
  canvasGroupIds: readonly number[],
  carouselGroupIds: readonly number[],
): number[] => {
  const visible = new Set(canvasGroupIds);
  return carouselGroupIds.filter((groupId) => !visible.has(groupId));
};

const dwellMs = (slide: CarouselSlideInput | undefined): number =>
  Math.max(1, (slide?.dwellSeconds ?? CAROUSEL_DEFAULT_DWELL_SECONDS) * 1000);

export const stepCarouselIndex = (
  slides: readonly CarouselSlideInput[],
  index: number,
  direction: 1 | -1,
): number => {
  const available = slides.flatMap((slide, slideIndex) => (slide.available ? [slideIndex] : []));
  if (available.length === 0) {
    return -1;
  }
  if (index < 0 || !slides[index]?.available) {
    if (direction > 0) {
      return available.find((slideIndex) => slideIndex > index) ?? available[0];
    }
    return [...available].reverse().find((slideIndex) => slideIndex < index) ?? available[available.length - 1];
  }
  const position = available.indexOf(index);
  const next = (position + direction + available.length) % available.length;
  return available[next];
};

const withIndex = (
  state: CarouselPlayerState,
  slides: CarouselSlideInput[],
  index: number,
  visit: number,
): CarouselPlayerState => ({
  slides,
  index,
  paused: state.paused,
  remainingMs: index < 0 ? 0 : dwellMs(slides[index]),
  visit,
});

export const createCarouselPlayerState = (
  slides: CarouselSlideInput[],
  preferKey?: string | null,
): CarouselPlayerState => {
  const preferred = preferKey ? slides.findIndex((slide) => slide.key === preferKey && slide.available) : -1;
  const index = preferred >= 0 ? preferred : stepCarouselIndex(slides, -1, 1);
  return {
    slides,
    index,
    paused: false,
    remainingMs: index < 0 ? 0 : dwellMs(slides[index]),
    visit: 0,
  };
};

export const reduceCarouselPlayer = (
  state: CarouselPlayerState,
  action: CarouselPlayerAction,
): CarouselPlayerState => {
  switch (action.type) {
    case 'reset': {
      const next = createCarouselPlayerState(action.slides, action.preferKey);
      const kept = Boolean(action.preferKey) && next.slides[next.index]?.key === action.preferKey;
      return {
        ...next,
        paused: state.paused,
        visit: kept || state.slides.length === 0 ? state.visit : state.visit + 1,
      };
    }
    case 'togglePause':
      if (state.index < 0) {
        return state;
      }
      return { ...state, paused: !state.paused };
    case 'tick': {
      if (state.paused || state.index < 0) {
        return state;
      }
      const remainingMs = state.remainingMs - Math.max(0, action.deltaMs);
      if (remainingMs > 0) {
        return { ...state, remainingMs };
      }
      const index = stepCarouselIndex(state.slides, state.index, 1);
      return withIndex(state, state.slides, index, state.visit + 1);
    }
    case 'next':
    case 'prev': {
      const index = stepCarouselIndex(state.slides, state.index, action.type === 'next' ? 1 : -1);
      if (index < 0) {
        return { ...state, index: -1, remainingMs: 0 };
      }
      return withIndex(state, state.slides, index, state.visit + 1);
    }
    case 'markUnavailable': {
      const target = state.slides.find((slide) => slide.key === action.key);
      if (!target?.available) {
        return state;
      }
      const slides = state.slides.map((slide) => (
        slide.key === action.key ? { ...slide, available: false } : slide
      ));
      const current = state.slides[state.index];
      if (!current || current.key !== action.key) {
        return { ...state, slides };
      }
      const index = stepCarouselIndex(slides, state.index, 1);
      return withIndex(state, slides, index, state.visit + 1);
    }
    default:
      return state;
  }
};

export const skippedCarouselCount = (state: CarouselPlayerState): number =>
  state.slides.filter((slide) => !slide.available).length;

export const isCarouselHotkeyBlocked = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('[role="listbox"], [role="combobox"], .ant-select, .ant-picker, .ant-modal'));
};

export const isCarouselOverlayOpen = (): boolean => {
  if (typeof document === 'undefined') {
    return false;
  }
  return Boolean(document.querySelector(
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  ));
};
