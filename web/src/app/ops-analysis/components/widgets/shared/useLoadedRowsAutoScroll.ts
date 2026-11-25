import { useEffect, type RefObject } from 'react';

const PORT_SELECTOR = '[data-auto-scroll-port], .ant-table-body';
const ROW_SELECTOR = '[data-auto-scroll-row], tr';

const findPort = (root: HTMLElement): HTMLElement | null => (
  root.querySelector<HTMLElement>(PORT_SELECTOR)
  || (root.matches(PORT_SELECTOR) ? root : null)
);

const overflows = (port: HTMLElement): boolean => (
  port.scrollHeight - port.clientHeight > 1
);

const stepDistance = (port: HTMLElement): number => {
  const rows = port.querySelectorAll<HTMLElement>(ROW_SELECTOR);
  for (const row of rows) {
    const rowHeight = row.offsetHeight;
    if (rowHeight > 0 && rowHeight < port.clientHeight) return rowHeight;
  }
  return Math.max(24, Math.round(port.clientHeight / 4));
};

/**
 * 只滚动已经渲染出来的内容区。表头和分页留在原位，也不翻页。
 * 内容没有溢出，或指针还在组件里时，不定时器。
 */
export function useLoadedRowsAutoScroll(
  rootRef: RefObject<HTMLElement | null>,
  options: { enabled: boolean; intervalMs: number },
): void {
  const { enabled, intervalMs } = options;

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return undefined;

    let timer: number | undefined;
    let paused = false;

    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };

    const step = () => {
      const port = findPort(root);
      if (!port || paused || !overflows(port)) {
        stop();
        return;
      }
      const distance = stepDistance(port);
      const max = port.scrollHeight - port.clientHeight;
      const next = port.scrollTop + distance;
      port.scrollTop = next >= max - 1 ? 0 : next;
    };

    const start = () => {
      const port = findPort(root);
      if (!port || paused || !overflows(port) || timer !== undefined) return;
      timer = window.setInterval(step, intervalMs);
    };

    const pause = () => {
      paused = true;
      stop();
    };

    const resume = () => {
      paused = false;
      start();
    };

    root.addEventListener('pointerenter', pause);
    root.addEventListener('pointerleave', resume);

    const resizeTargets = new Set<HTMLElement>();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        const port = findPort(root);
        if (!port || !overflows(port)) stop();
        else start();
      });
    const watchSize = () => {
      const port = findPort(root);
      if (!port || !resizeObserver || resizeTargets.has(port)) return;
      resizeTargets.add(port);
      resizeObserver.observe(port);
    };
    const sync = () => {
      watchSize();
      const port = findPort(root);
      if (!port || paused || !overflows(port)) stop();
      else start();
    };

    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    sync();

    return () => {
      stop();
      observer.disconnect();
      resizeObserver?.disconnect();
      root.removeEventListener('pointerenter', pause);
      root.removeEventListener('pointerleave', resume);
    };
  }, [enabled, intervalMs, rootRef]);
}
