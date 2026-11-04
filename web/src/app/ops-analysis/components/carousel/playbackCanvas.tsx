'use client';

import React from 'react';
import type { CanvasType } from '@/app/ops-analysis/constants/canvasTypes';
import type { DirItem } from '@/app/ops-analysis/types';
import Dashboard from '@/app/ops-analysis/(pages)/view/dashBoard';
import Topology from '@/app/ops-analysis/(pages)/view/topology';
import Architecture from '@/app/ops-analysis/(pages)/view/architecture';
import Screen from '@/app/ops-analysis/(pages)/view/screen';
import Report from '@/app/ops-analysis/(pages)/view/report';
import NetworkTopology from '@/app/ops-analysis/(pages)/view/networkTopology';
import { PlaybackInitialDetailProvider } from '@/app/ops-analysis/context/playbackInitialDetail';

export interface PlaybackSlide {
  key: string;
  resourceType: CanvasType;
  canvasId: number;
  name: string;
  dwellSeconds: number;
  available: boolean;
}

const toDirItem = (slide: PlaybackSlide): DirItem => ({
  id: `${slide.resourceType}_${slide.canvasId}`,
  data_id: String(slide.canvasId),
  name: slide.name,
  type: slide.resourceType,
});

const PlaybackCanvas = ({
  slide,
  presentFullscreen = false,
}: {
  slide: PlaybackSlide;
  presentFullscreen?: boolean;
}) => {
  const item = toDirItem(slide);
  switch (slide.resourceType) {
    case 'dashboard':
      return <Dashboard selectedDashboard={item} playbackMode />;
    case 'topology':
      return <Topology selectedTopology={item} playbackMode />;
    case 'architecture':
      return <Architecture selectedArchitecture={item} playbackMode />;
    case 'screen':
      return <Screen selectedScreen={item} playbackMode playbackFullscreen={presentFullscreen} />;
    case 'report':
      return <Report selectedReport={item} playbackMode />;
    case 'networkTopology':
      return <NetworkTopology selectedNetworkTopology={item} playbackMode />;
    default:
      return null;
  }
};

interface BoundaryProps {
  slideKey: string;
  onError: () => void;
  children: React.ReactNode;
}

interface BoundaryState {
  failedKey: string | null;
}

class PlaybackCanvasBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failedKey: null };

  static getDerivedStateFromError(): BoundaryState {
    return { failedKey: 'error' };
  }

  componentDidCatch() {
    this.props.onError();
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.slideKey !== this.props.slideKey && this.state.failedKey) {
      this.setState({ failedKey: null });
    }
  }

  render() {
    if (this.state.failedKey) {
      return null;
    }
    return this.props.children;
  }
}

export const PlaybackSlideFrame = ({
  slide,
  initialDetail,
  onError,
  presentFullscreen = false,
}: {
  slide: PlaybackSlide;
  initialDetail: unknown;
  onError: () => void;
  presentFullscreen?: boolean;
}) => {
  const seeded = React.useMemo(() => ({
    resourceType: slide.resourceType,
    canvasId: slide.canvasId,
    detail: initialDetail,
  }), [initialDetail, slide.canvasId, slide.resourceType]);
  return (
    <PlaybackInitialDetailProvider value={seeded}>
      <PlaybackCanvasBoundary slideKey={slide.key} onError={onError}>
        <PlaybackCanvas slide={slide} presentFullscreen={presentFullscreen} />
      </PlaybackCanvasBoundary>
    </PlaybackInitialDetailProvider>
  );
};

export default PlaybackCanvas;
