'use client';

import { useSyncExternalStore } from 'react';

import type { FilterValue, UnifiedFilterDefinition } from '@/app/ops-analysis/types/dashBoard';
import type { InteractionSurface } from '@/app/ops-analysis/utils/interactionLink';

export interface InteractionRuntimeSnapshot {
  surface: InteractionSurface;
  definitions: UnifiedFilterDefinition[];
  values: Record<string, FilterValue>;
}

const EMPTY_RUNTIME: InteractionRuntimeSnapshot = {
  surface: 'view',
  definitions: [],
  values: {},
};

let currentRuntime = EMPTY_RUNTIME;
const listeners = new Set<() => void>();

export const setInteractionRuntime = (next: InteractionRuntimeSnapshot) => {
  currentRuntime = next;
  listeners.forEach((listener) => listener());
};

export const resetInteractionRuntime = () => {
  setInteractionRuntime(EMPTY_RUNTIME);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useInteractionRuntime = () =>
  useSyncExternalStore(subscribe, () => currentRuntime, () => EMPTY_RUNTIME);
