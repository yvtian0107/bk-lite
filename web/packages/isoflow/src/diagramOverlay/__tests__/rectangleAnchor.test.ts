import assert from 'node:assert/strict';
import { getTilePosition } from 'src/utils/renderer';
import {
  getRectangleFrontTile,
  getRectangleFrontVertex,
  getRectangleTopTile,
  getRectangleTopVertex
} from '../rectangleAnchor';

const forward = { from: { x: 0, y: 1 }, to: { x: 2, y: 4 } };
const reversed = { from: { x: 2, y: 4 }, to: { x: 0, y: 1 } };

assert.deepEqual(getRectangleTopTile(forward.from, forward.to), { x: 2, y: 4 });
assert.deepEqual(
  getRectangleTopTile(reversed.from, reversed.to),
  getRectangleTopTile(forward.from, forward.to)
);
assert.deepEqual(
  getRectangleTopVertex(reversed.from, reversed.to),
  getRectangleTopVertex(forward.from, forward.to)
);

const peak = getRectangleTopVertex(forward.from, forward.to);
const corners = [
  { x: 0, y: 1 },
  { x: 2, y: 1 },
  { x: 0, y: 4 },
  { x: 2, y: 4 }
];

corners.forEach((tile) => {
  const top = getTilePosition({ tile, origin: 'TOP' });
  assert.ok(peak.y <= top.y);
});

assert.deepEqual(getRectangleFrontTile(forward.from, forward.to), { x: 0, y: 1 });
assert.deepEqual(
  getRectangleFrontTile(reversed.from, reversed.to),
  getRectangleFrontTile(forward.from, forward.to)
);
assert.deepEqual(
  getRectangleFrontVertex(reversed.from, reversed.to),
  getRectangleFrontVertex(forward.from, forward.to)
);

const front = getRectangleFrontVertex(forward.from, forward.to);
corners.forEach((tile) => {
  const bottom = getTilePosition({ tile, origin: 'BOTTOM' });
  assert.ok(front.y >= bottom.y);
});

console.log('rectangleAnchor ok');
