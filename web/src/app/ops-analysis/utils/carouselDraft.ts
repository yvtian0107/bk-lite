import { CAROUSEL_MAX_ITEMS } from '@/app/ops-analysis/utils/carouselPlayer';

export const CAROUSEL_REMAINING_HINT_AT = 10;

export interface CarouselCanvasRef {
  resourceType: string;
  canvasId: number;
}

export interface CarouselDurationItem {
  dwellSeconds: number | null;
  countsTowardDuration: boolean;
}

export const canvasIdentityKey = (resourceType: string, canvasId: number): string =>
  `${resourceType}:${canvasId}`;

export const duplicateCanvasKeys = (items: readonly CarouselCanvasRef[]): string[] => {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = canvasIdentityKey(item.resourceType, item.canvasId);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
};

export const syncCarouselSelection = <Current, Selected extends CarouselCanvasRef>(
  current: readonly Current[],
  selected: readonly Selected[],
  keyOf: (item: Current) => string,
  createItem: (canvas: Selected) => Current,
): { items: Current[]; added: number; removed: number } => {
  const selectedKeys = new Set(selected.map((item) => canvasIdentityKey(item.resourceType, item.canvasId)));
  const kept: Current[] = [];
  const present = new Set<string>();
  let removed = 0;
  current.forEach((item) => {
    const key = keyOf(item);
    if (!selectedKeys.has(key)) {
      removed += 1;
      return;
    }
    kept.push(item);
    present.add(key);
  });
  const addedItems: Current[] = [];
  selected.forEach((canvas) => {
    const key = canvasIdentityKey(canvas.resourceType, canvas.canvasId);
    if (present.has(key)) {
      return;
    }
    present.add(key);
    addedItems.push(createItem(canvas));
  });
  return { items: [...kept, ...addedItems], added: addedItems.length, removed };
};

export const selectionChangeCounts = (
  current: readonly CarouselCanvasRef[],
  selectedKeys: readonly string[],
): { added: number; removed: number; selected: number } => {
  const selected = new Set(selectedKeys);
  const present = new Set<string>();
  let removed = 0;
  current.forEach((item) => {
    const key = canvasIdentityKey(item.resourceType, item.canvasId);
    if (selected.has(key)) {
      present.add(key);
      return;
    }
    removed += 1;
  });
  let added = 0;
  selected.forEach((key) => {
    if (!present.has(key)) {
      added += 1;
    }
  });
  return { added, removed, selected: selected.size };
};

/** 勾选目录会一次带上多个画布。超过上限时整次勾选不生效，已勾选的保留。 */
export const mergeCanvasChecks = (
  current: readonly string[],
  visibleKeys: readonly string[],
  nextVisibleKeys: readonly string[],
  max = CAROUSEL_MAX_ITEMS,
): { keys: string[]; blocked: boolean } => {
  const visible = new Set(visibleKeys);
  const preserved = current.filter((key) => !visible.has(key));
  const merged = [...preserved, ...nextVisibleKeys.filter((key) => visible.has(key))];
  const unique = [...new Set(merged)];
  const currentSize = new Set(current).size;
  if (unique.length > max && unique.length > currentSize) {
    return { keys: [...new Set(current)], blocked: true };
  }
  return { keys: unique, blocked: false };
};

export const shouldShowRemainingCapacity = (
  selected: number,
  max = CAROUSEL_MAX_ITEMS,
): boolean => {
  const remaining = max - selected;
  return remaining >= 0 && remaining <= CAROUSEL_REMAINING_HINT_AT;
};

export const remainingCapacity = (selected: number, max = CAROUSEL_MAX_ITEMS): number =>
  Math.max(0, max - selected);

export const carouselRoundSeconds = (
  items: readonly CarouselDurationItem[],
  defaultDwell: number,
): number => items.reduce((total, item) => {
  if (!item.countsTowardDuration) {
    return total;
  }
  return total + (item.dwellSeconds ?? defaultDwell);
}, 0);

export const splitCarouselDuration = (totalSeconds: number): { minutes: number; seconds: number } => {
  const safe = Math.max(0, Math.round(totalSeconds));
  return { minutes: Math.floor(safe / 60), seconds: safe % 60 };
};

export const carouselDurationMessage = (
  totalSeconds: number,
): { id: string; values: Record<string, number> } => {
  const { minutes, seconds } = splitCarouselDuration(totalSeconds);
  if (minutes <= 0) {
    return { id: 'opsCarousel.durationSeconds', values: { count: seconds } };
  }
  if (seconds === 0) {
    return { id: 'opsCarousel.durationMinutes', values: { count: minutes } };
  }
  return { id: 'opsCarousel.durationMinutesSeconds', values: { minutes, seconds } };
};
