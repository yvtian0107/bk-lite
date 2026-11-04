import { describe, expect, it } from 'vitest';
import { CAROUSEL_MAX_ITEMS } from '@/app/ops-analysis/utils/carouselPlayer';
import {
  canvasIdentityKey,
  carouselRoundSeconds,
  duplicateCanvasKeys,
  mergeCanvasChecks,
  remainingCapacity,
  selectionChangeCounts,
  shouldShowRemainingCapacity,
  syncCarouselSelection,
} from '@/app/ops-analysis/utils/carouselDraft';

interface Row {
  key: string;
  resourceType: string;
  canvasId: number;
  dwellSeconds: number | null;
}

const row = (canvasId: number, dwellSeconds: number | null = null, resourceType = 'dashboard'): Row => ({
  key: `${resourceType}-${canvasId}-${dwellSeconds ?? 'default'}`,
  resourceType,
  canvasId,
  dwellSeconds,
});

const canvas = (canvasId: number, resourceType = 'dashboard') => ({ resourceType, canvasId, name: String(canvasId) });

describe('carousel draft selection', () => {
  it('appends new canvases, removes unchecked ones, and keeps order and dwell', () => {
    const current = [row(1, 12), row(2, null), row(3, 40)];
    const selected = [canvas(1), canvas(3), canvas(4), canvas(5)];
    const result = syncCarouselSelection(
      current,
      selected,
      (item) => canvasIdentityKey(item.resourceType, item.canvasId),
      (item) => row(item.canvasId, 7),
    );
    expect(result.added).toBe(2);
    expect(result.removed).toBe(1);
    expect(result.items.map((item) => [item.canvasId, item.dwellSeconds])).toEqual([
      [1, 12],
      [3, 40],
      [4, 7],
      [5, 7],
    ]);
  });

  it('does not add a canvas that is already in the list', () => {
    const current = [row(1, 9), row(1, 15)];
    const result = syncCarouselSelection(
      current,
      [canvas(1), canvas(1)],
      (item) => canvasIdentityKey(item.resourceType, item.canvasId),
      (item) => row(item.canvasId, null),
    );
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.items).toEqual(current);
    expect(duplicateCanvasKeys(current)).toEqual(['dashboard:1']);
  });

  it('counts row removals when a duplicated canvas is unchecked', () => {
    const current = [row(1), row(1), row(2, 20)];
    expect(selectionChangeCounts(
      current.map((item) => ({ resourceType: item.resourceType, canvasId: item.canvasId })),
      ['dashboard:2'],
    )).toEqual({ added: 0, removed: 2, selected: 1 });
  });

  it('blocks a directory check that would pass the 50 canvas limit', () => {
    const current = Array.from({ length: 49 }, (_, index) => `dashboard:${index + 1}`);
    const visible = ['dashboard:50', 'dashboard:51'];
    const blocked = mergeCanvasChecks(current, visible, visible);
    expect(blocked.blocked).toBe(true);
    expect(blocked.keys).toEqual(current);

    const oneMore = mergeCanvasChecks(current, ['dashboard:50'], ['dashboard:50']);
    expect(oneMore.blocked).toBe(false);
    expect(oneMore.keys).toHaveLength(50);

    const hiddenKept = mergeCanvasChecks(
      ['screen:1', 'dashboard:2'],
      ['dashboard:2', 'dashboard:3'],
      ['dashboard:3'],
    );
    expect(hiddenKept.blocked).toBe(false);
    expect(hiddenKept.keys).toEqual(['screen:1', 'dashboard:3']);
  });

  it('shows remaining capacity only near the limit', () => {
    expect(shouldShowRemainingCapacity(30)).toBe(false);
    expect(shouldShowRemainingCapacity(CAROUSEL_MAX_ITEMS - 10)).toBe(true);
    expect(shouldShowRemainingCapacity(CAROUSEL_MAX_ITEMS)).toBe(true);
    expect(remainingCapacity(CAROUSEL_MAX_ITEMS - 3)).toBe(3);
  });

  it('sums dwell from valid canvases and skips invalid ones', () => {
    expect(carouselRoundSeconds([
      { dwellSeconds: 10, countsTowardDuration: true },
      { dwellSeconds: null, countsTowardDuration: true },
      { dwellSeconds: 300, countsTowardDuration: false },
    ], 30)).toBe(40);
  });
});
