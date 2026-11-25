export const positiveSeriesMax = (data: unknown): number => {
  if (!Array.isArray(data)) return 0;
  let max = 0;
  for (const value of data) {
    if (typeof value === 'number' && Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max;
};
