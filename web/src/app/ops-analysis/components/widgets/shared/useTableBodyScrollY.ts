import { useEffect, useState, type RefObject } from 'react';

interface UseTableBodyScrollYOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  hasPagination: boolean;
}

/**
 * 与 CustomTable size="small" 加回的高度相同：表头 47、分页 56。
 * widgetUiScale 已经用在大屏字号和单元格 padding 上，这里不能再乘一次。
 * 返回值是数字，交给 CustomTable 的 scroll.y。数字不再被抬到 160。
 * 无分页时省略 y 会让表体按内容撑高，再被卡片 overflow:hidden 裁掉且无法滚动。
 */
export const resolveTableBodyScrollY = ({
  containerHeight,
  hasPagination,
}: {
  containerHeight: number;
  hasPagination: boolean;
}): number => {
  const headerHeight = 47;
  const paginationHeight = hasPagination ? 56 : 0;
  return Math.max(0, containerHeight - headerHeight - paginationHeight);
};

export const useTableBodyScrollY = ({
  containerRef,
  hasPagination,
}: UseTableBodyScrollYOptions): number | undefined => {
  const [tableScrollY, setTableScrollY] = useState<number>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScrollY = () => {
      if (container.clientHeight <= 0) return;
      const nextHeight = resolveTableBodyScrollY({
        containerHeight: container.clientHeight,
        hasPagination,
      });
      setTableScrollY((previous) => (previous === nextHeight ? previous : nextHeight));
    };

    updateScrollY();

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateScrollY);
      resizeObserver.observe(container);
      if (container.parentElement) {
        resizeObserver.observe(container.parentElement);
      }
    }
    window.addEventListener('resize', updateScrollY);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateScrollY);
    };
  }, [containerRef, hasPagination]);

  return tableScrollY;
};
