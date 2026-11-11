export interface PageSlice {
  shown: number;
  total: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 信封上的 count 大于当前 items 时，图上的百分比和名次只覆盖这一页。 */
export const readPageSlice = (rawData: unknown): PageSlice | null => {
  if (!isRecord(rawData)) return null;
  const items = Array.isArray(rawData.items)
    ? rawData.items
    : Array.isArray(rawData.data)
      ? rawData.data
      : null;
  if (!items) return null;
  const total = rawData.count;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= items.length) return null;
  return { shown: items.length, total };
};
