/** 编辑态不能开始预览轮播。查看态可以。 */
export const canStartCarouselPreview = (editing: boolean): boolean => !editing;

/**
 * 当前预览项被删掉时，落到原来的下一张；已经是最后一张则落到上一张。
 * 删的是别的项时，仍停在同一张画布上。
 */
export const relocatePreviewIndex = (
  previousIndex: number,
  removedIndexes: readonly number[],
  nextLength: number,
): number => {
  if (nextLength <= 0) {
    return -1;
  }
  const removedBefore = removedIndexes.filter((index) => index < previousIndex).length;
  const removedCurrent = removedIndexes.includes(previousIndex);
  const shifted = previousIndex - removedBefore;
  if (removedCurrent) {
    return Math.min(Math.max(shifted, 0), nextLength - 1);
  }
  return Math.min(Math.max(shifted, 0), nextLength - 1);
};

export const relocatePreviewIndexByKeys = (
  previousKeys: readonly string[],
  previousIndex: number,
  nextKeys: readonly string[],
): number => {
  if (nextKeys.length === 0) {
    return -1;
  }
  const key = previousKeys[previousIndex];
  if (key) {
    const found = nextKeys.indexOf(key);
    if (found >= 0) {
      return found;
    }
  }
  if (previousKeys.length === 0) {
    return 0;
  }
  const removed = previousKeys.flatMap((item, index) => (nextKeys.includes(item) ? [] : [index]));
  return relocatePreviewIndex(previousIndex, removed, nextKeys.length);
};

/** 缩略条和上一张/下一张按完整列表相邻移动，失效项也算一张。 */
export const manualPreviewStep = (length: number, index: number, direction: 1 | -1): number => {
  if (length <= 0) {
    return -1;
  }
  if (index < 0) {
    return direction > 0 ? 0 : length - 1;
  }
  return (index + direction + length) % length;
};
