'use client';

import { useEffect, useRef, useState } from 'react';
import { useArchitectureApi } from '@/app/ops-analysis/api/architecture';
import type { ArchitectureNodeStatusItem } from './model';
import {
  keptStatusForRequest,
  mergeStatusResponse,
  shouldPauseArchitectureStatusRefresh,
  unknownStatusMap,
} from './status';

export function useArchitectureNodeStatus(options: {
  enabled: boolean;
  uuids: string[];
  intervalMs: number;
}) {
  const { queryNodeStatus } = useArchitectureApi();
  const queryRef = useRef(queryNodeStatus);
  queryRef.current = queryNodeStatus;
  const [byUuid, setByUuid] = useState<Record<string, ArchitectureNodeStatusItem>>({});
  const [phase, setPhase] = useState<'idle' | 'ready' | 'failed'>('idle');
  const cacheRef = useRef<Record<string, ArchitectureNodeStatusItem>>({});
  const signature = options.uuids.join('\n');

  useEffect(() => {
    // Keep the last names while edit mode pauses polling, so cancel does not
    // flash Untitled before the next response.
    if (!options.enabled) return undefined;
    const requested = signature ? signature.split('\n') : [];
    if (!requested.length) {
      setByUuid({});
      setPhase('ready');
      return undefined;
    }
    const kept = keptStatusForRequest(cacheRef.current, requested);
    setByUuid(kept);
    setPhase(Object.keys(kept).length ? 'ready' : 'idle');

    let cancelled = false;
    let timer = 0;
    let seq = 0;
    const apply = (
      next: Record<string, ArchitectureNodeStatusItem>,
      nextPhase: 'ready' | 'failed',
      current: number,
    ) => {
      if (cancelled || current !== seq) return;
      cacheRef.current = { ...cacheRef.current, ...next };
      setByUuid(next);
      setPhase(nextPhase);
    };
    const run = () => {
      if (shouldPauseArchitectureStatusRefresh(typeof document !== 'undefined' && document.hidden)) {
        return;
      }
      const current = ++seq;
      queryRef.current(requested)
        .then((data) => {
          const items = Array.isArray(data?.items) ? data.items : [];
          apply(mergeStatusResponse(requested, items), 'ready', current);
        })
        .catch(() => {
          apply(unknownStatusMap(requested), 'failed', current);
        });
    };

    run();
    if (options.intervalMs > 0) {
      const arm = () => {
        timer = window.setTimeout(() => {
          run();
          if (!cancelled) arm();
        }, options.intervalMs);
      };
      arm();
    }
    const onVisibility = () => {
      if (!document.hidden) run();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [options.enabled, options.intervalMs, signature]);

  return { byUuid, phase };
}
