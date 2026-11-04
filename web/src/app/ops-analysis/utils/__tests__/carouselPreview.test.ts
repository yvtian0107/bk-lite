import { describe, expect, it } from 'vitest';
import {
  canStartCarouselPreview,
  manualPreviewStep,
  relocatePreviewIndexByKeys,
} from '@/app/ops-analysis/utils/carouselPreview';

describe('carousel preview', () => {
  it('falls back to the next item, or the previous one at the end', () => {
    expect(relocatePreviewIndexByKeys(['a', 'b', 'c'], 1, ['a', 'c'])).toBe(1);
    expect(relocatePreviewIndexByKeys(['a', 'b', 'c'], 2, ['a', 'b'])).toBe(1);
    expect(relocatePreviewIndexByKeys(['a', 'b', 'c'], 2, ['b', 'c'])).toBe(1);
    expect(relocatePreviewIndexByKeys(['a', 'b', 'c'], 0, [])).toBe(-1);
  });

  it('keeps the same canvas when the list is reordered', () => {
    expect(relocatePreviewIndexByKeys(['a', 'b', 'c'], 0, ['b', 'c', 'a'])).toBe(2);
  });

  it('refuses playback while the editor is open and steps through every row', () => {
    expect(canStartCarouselPreview(true)).toBe(false);
    expect(canStartCarouselPreview(false)).toBe(true);
    expect(manualPreviewStep(3, 2, 1)).toBe(0);
    expect(manualPreviewStep(3, 0, -1)).toBe(2);
  });
});