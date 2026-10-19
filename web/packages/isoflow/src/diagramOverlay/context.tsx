import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef
} from 'react';
import type {
  EditorModeEnum,
  ItemControls,
  NodeStatus,
  RectangleStatus
} from 'src/types';
import { useUiStateStore } from 'src/stores/uiStateStore';
import {
  DiagramCallbacksRef,
  emitItemSelect,
  isSelectableDiagramItem
} from './callbacks';

export interface DiagramVisual {
  nodeStatus?: Record<string, NodeStatus>;
  rectangleStatus?: Record<string, RectangleStatus>;
  highlightedItemId?: string;
  editorMode: keyof typeof EditorModeEnum;
}

const EMPTY_VISUAL: DiagramVisual = {
  editorMode: 'EDITABLE'
};

const DiagramVisualContext = createContext<DiagramVisual>(EMPTY_VISUAL);

const DiagramCallbacksContext = createContext<DiagramCallbacksRef>({
  current: {
    editorMode: 'EDITABLE',
    lastSelectKey: ''
  }
});

interface ProviderProps {
  children: React.ReactNode;
  onItemClick?: DiagramCallbacksRef['current']['onItemClick'];
  onItemSelect?: DiagramCallbacksRef['current']['onItemSelect'];
  nodeStatus?: Record<string, NodeStatus>;
  rectangleStatus?: Record<string, RectangleStatus>;
  highlightedItemId?: string;
  editorMode?: keyof typeof EditorModeEnum;
}

export const DiagramOverlayProvider = ({
  children,
  onItemClick,
  onItemSelect,
  nodeStatus,
  rectangleStatus,
  highlightedItemId,
  editorMode = 'EDITABLE'
}: ProviderProps) => {
  const callbacksRef = useRef<DiagramCallbacksRef['current']>({
    editorMode,
    lastSelectKey: ''
  });

  if (callbacksRef.current.editorMode !== editorMode) {
    callbacksRef.current.lastSelectKey = '';
  }

  callbacksRef.current.onItemClick = onItemClick;
  callbacksRef.current.onItemSelect = onItemSelect;
  callbacksRef.current.editorMode = editorMode;

  const visual = useMemo<DiagramVisual>(() => {
    return {
      nodeStatus,
      rectangleStatus,
      highlightedItemId,
      editorMode
    };
  }, [editorMode, highlightedItemId, nodeStatus, rectangleStatus]);

  return (
    <DiagramCallbacksContext.Provider value={callbacksRef}>
      <DiagramVisualContext.Provider value={visual}>
        <SelectionDismissWatcher
          callbacksRef={callbacksRef}
          editorMode={editorMode}
        />
        {children}
      </DiagramVisualContext.Provider>
    </DiagramCallbacksContext.Provider>
  );
};

const SelectionDismissWatcher = ({
  callbacksRef,
  editorMode
}: {
  callbacksRef: DiagramCallbacksRef;
  editorMode: keyof typeof EditorModeEnum;
}) => {
  const itemControls = useUiStateStore((state) => {
    return state.itemControls;
  });
  const prevControls = useRef<ItemControls | null | undefined>(undefined);

  useEffect(() => {
    const prev = prevControls.current;
    prevControls.current = itemControls;

    if (prev === undefined || editorMode !== 'EDITABLE') return;

    if (
      isSelectableDiagramItem(prev) &&
      !isSelectableDiagramItem(itemControls)
    ) {
      emitItemSelect(callbacksRef, null);
    }
  }, [callbacksRef, editorMode, itemControls]);

  return null;
};

export const useDiagramVisual = () => {
  return useContext(DiagramVisualContext);
};

export const useDiagramCallbacksRef = () => {
  return useContext(DiagramCallbacksContext);
};
