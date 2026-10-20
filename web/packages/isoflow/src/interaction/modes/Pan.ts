import { produce } from 'immer';
import { CoordsUtils, getItemAtTile, setWindowCursor } from 'src/utils';
import { ModeActions, State } from 'src/types';
import {
  findDrawnIconId,
  resolveViewClick,
  viewHoverCursor
} from 'src/interaction/viewPointer';

const CLICK_THRESHOLD_PX = 4;

const isCanvasPointer = (state: State) => {
  if (state.isRendererInteraction) return true;

  const target = state.pointer.event.target;
  const rendererEl = state.uiState.rendererEl;

  return target instanceof Node && !!rendererEl && rendererEl.contains(target);
};

const isViewClickMode = (state: State) => {
  return (
    state.uiState.editorMode === 'EXPLORABLE_READONLY' &&
    state.callbacksRef.current.editorMode === 'EXPLORABLE_READONLY' &&
    !!state.callbacksRef.current.onItemClick
  );
};

const updateViewCursor = (state: State, element: HTMLElement) => {
  if (!isViewClickMode(state) || !isCanvasPointer(state)) {
    setWindowCursor('grab', element);
    return;
  }

  const iconId = findDrawnIconId(state.uiState.rendererEl, {
    x: state.pointer.event.clientX,
    y: state.pointer.event.clientY
  });
  const tileHit = getItemAtTile({
    tile: state.pointer.mouse.position.tile,
    scene: state.scene
  });

  setWindowCursor(viewHoverCursor({ iconId, tileHit }), element);
};

export const Pan: ModeActions = {
  entry: (state, element) => {
    setWindowCursor('grab', element);
  },
  exit: (state, element) => {
    setWindowCursor('default', element);
  },
  mousemove: (state, element) => {
    const { uiState } = state;

    if (uiState.mode.type !== 'PAN') return;

    if (uiState.mouse.mousedown !== null) {
      const newScroll = produce(uiState.scroll, (draft) => {
        draft.position = uiState.mouse.delta?.screen
          ? CoordsUtils.add(draft.position, uiState.mouse.delta.screen)
          : draft.position;
      });

      uiState.actions.setScroll(newScroll);
      return;
    }

    updateViewCursor(state, element);
  },
  mousedown: (state, element) => {
    const { uiState, isRendererInteraction, pointer, panPressRef } = state;

    if (uiState.mode.type !== 'PAN') return;

    if (!isCanvasPointer(state)) {
      panPressRef.current = null;
      return;
    }

    panPressRef.current = {
      x: pointer.mouse.position.screen.x,
      y: pointer.mouse.position.screen.y
    };

    if (!isRendererInteraction) return;

    setWindowCursor('grabbing', element);
  },
  mouseup: (state, element) => {
    updateViewCursor(state, element);

    const { uiState, scene, pointer, panPressRef, callbacksRef } = state;
    const press = panPressRef.current;
    panPressRef.current = null;

    if (uiState.mode.type !== 'PAN') return;
    if (!isViewClickMode(state)) return;
    if (!press || !isCanvasPointer(state)) return;

    const dx = pointer.mouse.position.screen.x - press.x;
    const dy = pointer.mouse.position.screen.y - press.y;

    if (dx * dx + dy * dy >= CLICK_THRESHOLD_PX * CLICK_THRESHOLD_PX) return;

    const onItemClick = callbacksRef.current.onItemClick;

    if (!onItemClick) return;

    const iconId = findDrawnIconId(uiState.rendererEl, {
      x: pointer.event.clientX,
      y: pointer.event.clientY
    });
    const decision = resolveViewClick({
      iconId,
      tileHit: getItemAtTile({
        tile: pointer.mouse.position.tile,
        scene
      })
    });

    if (decision.kind === 'click') {
      onItemClick(decision.item, pointer.event);
    }
  }
};
