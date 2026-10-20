import type { Coords } from 'src/types';
import { getTilePosition, sortByPosition } from 'src/utils/renderer';

// Screen-top vertex of a rectangle. Tile y grows toward the top of the
// isometric view, so the corner with the greatest x + y is the peak.
// low/high normalisation makes from/to order irrelevant.
export const getRectangleTopTile = (from: Coords, to: Coords): Coords => {
  const { highX, highY } = sortByPosition([from, to]);

  return { x: highX, y: highY };
};

export const getRectangleTopVertex = (from: Coords, to: Coords): Coords => {
  return getTilePosition({
    tile: getRectangleTopTile(from, to),
    origin: 'TOP'
  });
};

// Screen-front vertex. The corner with the smallest x + y is nearest the
// viewer, and BOTTOM origin sits on the outside of that corner.
export const getRectangleFrontTile = (from: Coords, to: Coords): Coords => {
  const { lowX, lowY } = sortByPosition([from, to]);

  return { x: lowX, y: lowY };
};

export const getRectangleFrontVertex = (from: Coords, to: Coords): Coords => {
  return getTilePosition({
    tile: getRectangleFrontTile(from, to),
    origin: 'BOTTOM'
  });
};
