import React, { useRef } from 'react';
import { readAutoScroll } from '@/app/ops-analysis/utils/widgetAutoScroll';
import { useLoadedRowsAutoScroll } from './useLoadedRowsAutoScroll';

interface AutoScrollRegionProps {
  config?: { autoScroll?: { enabled?: unknown; intervalMs?: unknown } };
  className?: string;
  style?: React.CSSProperties;
  scrollPort?: boolean;
  children: React.ReactNode;
}

const AutoScrollRegion: React.FC<AutoScrollRegionProps> = ({
  config,
  className,
  style,
  scrollPort = false,
  children,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const scroll = readAutoScroll(config);
  useLoadedRowsAutoScroll(rootRef, scroll);

  return (
    <div
      ref={rootRef}
      className={className}
      style={style}
      {...(scrollPort ? { 'data-auto-scroll-port': '' } : {})}
    >
      {children}
    </div>
  );
};

export default AutoScrollRegion;
