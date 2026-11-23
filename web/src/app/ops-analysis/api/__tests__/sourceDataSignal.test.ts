// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  post: vi.fn(async () => ({ result: true, data: { rows: [] } })),
  get: vi.fn(),
}));

vi.mock('@/utils/request', () => ({
  default: () => ({
    post: testState.post,
    get: testState.get,
  }),
}));

vi.mock('@/utils/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useCanvasShareApi } from '@/app/ops-analysis/api/dashboardShare';
import { useScreenDisplayApi } from '@/app/ops-analysis/api/screenDisplay';

describe('shared and display source queries forward AbortSignal', () => {
  it('posts the share query with the caller signal and the same url', () => {
    const { result } = renderHook(() => useCanvasShareApi());
    const controller = new AbortController();
    void result.current.querySharedDataSource('session-1', 9, { range: 'now' }, {
      suppressErrorNotification: true,
      signal: controller.signal,
    });
    expect(testState.post).toHaveBeenCalledWith(
      '/operation_analysis/api/dashboard_share/session/session-1/query/9/',
      { range: 'now' },
      {
        suppressErrorNotification: true,
        signal: controller.signal,
      },
    );
  });

  it('posts the display query with the caller signal and keeps error suppression', () => {
    testState.post.mockClear();
    const { result } = renderHook(() => useScreenDisplayApi());
    const controller = new AbortController();
    void result.current.queryDisplayDataSource(9, { range: 'now' }, {
      signal: controller.signal,
    });
    expect(testState.post).toHaveBeenCalledWith(
      '/operation_analysis/api/screen_display/current/query/9/',
      { range: 'now' },
      {
        suppressErrorNotification: true,
        signal: controller.signal,
      },
    );
  });
});
