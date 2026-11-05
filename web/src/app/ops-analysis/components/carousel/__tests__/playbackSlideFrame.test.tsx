import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlaybackSlide } from '@/app/ops-analysis/components/carousel/playbackCanvas';

const paint = vi.hoisted(() => ({ dashboard: 0 }));

vi.mock('@/app/ops-analysis/(pages)/view/dashBoard', () => ({
  default: () => {
    paint.dashboard += 1;
    return <div data-testid="dashboard-canvas" />;
  },
}));

vi.mock('@/app/ops-analysis/(pages)/view/topology', () => ({
  default: () => null,
}));

vi.mock('@/app/ops-analysis/(pages)/view/architecture', () => ({
  default: () => null,
}));

vi.mock('@/app/ops-analysis/(pages)/view/screen', () => ({
  default: () => null,
}));

vi.mock('@/app/ops-analysis/(pages)/view/report', () => ({
  default: () => null,
}));

vi.mock('@/app/ops-analysis/(pages)/view/networkTopology', () => ({
  default: () => null,
}));

import { PlaybackSlideFrame } from '@/app/ops-analysis/components/carousel/playbackCanvas';

const slide: PlaybackSlide = {
  key: 's0',
  resourceType: 'dashboard',
  canvasId: 7,
  name: '机房总览',
  dwellSeconds: 30,
  available: true,
};

const onError = () => undefined;

describe('PlaybackSlideFrame', () => {
  it('keeps the canvas mounted when the parent repaints with the same slide inputs', () => {
    paint.dashboard = 0;
    const detail = { id: 7, name: '机房总览' };
    const view = render(
      <PlaybackSlideFrame
        slide={slide}
        initialDetail={detail}
        onError={onError}
        presentFullscreen={false}
      />,
    );
    expect(paint.dashboard).toBe(1);

    view.rerender(
      <PlaybackSlideFrame
        slide={{ ...slide }}
        initialDetail={detail}
        onError={onError}
        presentFullscreen={false}
      />,
    );
    expect(paint.dashboard).toBe(1);

    view.rerender(
      <PlaybackSlideFrame
        slide={{ ...slide }}
        initialDetail={{ id: 7, name: '新详情' }}
        onError={onError}
        presentFullscreen={false}
      />,
    );
    expect(paint.dashboard).toBe(2);
  });
});
