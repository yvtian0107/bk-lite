'use client';

import React, { createContext, useContext, useMemo } from 'react';

import type { ScreenRenderContext } from '@/app/ops-analysis/types/dashBoard';
import { resolveInteractionMenuScale } from '@/app/ops-analysis/utils/interactionMenuScale';

const InteractionMenuScaleContext = createContext(1);

export function InteractionMenuScaleProvider({
  context,
  children,
}: {
  context?: ScreenRenderContext | null;
  children: React.ReactNode;
}) {
  const scale = useMemo(() => resolveInteractionMenuScale(context), [context]);
  return (
    <InteractionMenuScaleContext.Provider value={scale}>
      {children}
    </InteractionMenuScaleContext.Provider>
  );
}

export const useInteractionMenuScale = () => useContext(InteractionMenuScaleContext);
