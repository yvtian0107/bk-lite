import { produce } from 'immer';
import { CoordsUtils, getItemAtTile, setWindowCursor } from 'src/utils';
import { ModeActions, State } from 'src/types';

const CLICK_THRESHOLD_PX = 4;

const isCanvasPointer = (state: State) => {
  if (state.isRendererInteraction) return true;

  const target = state.pointer.event.target;
  const rendererEl = state.uiState.rendererEl;

  return target instanceof Node && !!rendererEl && rendererEl.contains(target);
};

export const Pan: ModeActions = {
  entry: (state, element) => {
    setWindowCursor('grab', element);
  },
  exit: (state, element) => {
    setWindowCursor('default', element);
  },
  mousemove: ({ uiState }) => {
    if (uiState.mode.type !== 'PAN') return;

    if (uiState.mouse.mousedown !== null) {
      const newScroll = produce(uiState.scroll, (draft) => {
        draft.position = uiState.mouse.delta?.screen
          ? CoordsUtils.add(draft.position, uiState.mouse.delta.screen)
          : draft.position;
      });

      uiState.actions.setScroll(newScroll);
    }
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
    setWindowCursor('grab', element);

    const { uiState, scene, pointer, panPressRef, callbacksRef } = state;
    const press = panPressRef.current;
    panPressRef.current = null;

    if (uiState.mode.type !== 'PAN') return;
    if (uiState.editorMode !== 'EXPLORABLE_READONLY') return;
    if (callbacksRef.current.editorMode !== 'EXPLORABLE_READONLY') return;
    if (!press || !isCanvasPointer(state)) return;

    const dx = pointer.mouse.position.screen.x - press.x;
    const dy = pointer.mouse.position.screen.y - press.y;

    if (dx * dx + dy * dy >= CLICK_THRESHOLD_PX * CLICK_THRESHOLD_PX) return;

    const onItemClick = callbacksRef.current.onItemClick;

    if (!onItemClick) return;

    const hit = getItemAtTile({
      tile: pointer.mouse.position.tile,
      scene
    });

    if (hit?.type === 'TEXTBOX') return;

    if (
      hit &&
      (hit.type === 'ITEM' ||
        hit.type === 'RECTANGLE' ||
        hit.type === 'CONNECTOR')
    ) {
      onItemClick({ type: hit.type, id: hit.id }, pointer.event);
      return;
    }

    if (!hit) onItemClick(null, pointer.event);
  }
};
