import React, { useState } from 'react';
import { ViewItem } from 'src/types';
import { Node, NodeLabelLayerContext } from './Node/Node';

interface Props {
  nodes: ViewItem[];
}

export const Nodes = ({ nodes }: Props) => {
  const [labelRoot, setLabelRoot] = useState<HTMLDivElement | null>(null);
  // Back first so a nearer plate is portaled later and wins when plates overlap.
  const backToFront = [...nodes].sort(
    (a, b) => b.tile.x + b.tile.y - (a.tile.x + a.tile.y)
  );

  return (
    <NodeLabelLayerContext.Provider value={labelRoot}>
      {backToFront.map((node) => {
        return (
          <Node key={node.id} order={-node.tile.x - node.tile.y} node={node} />
        );
      })}
      {/* Plates escape icon z-index. A nearer icon would otherwise cover the plate behind it. */}
      <div
        ref={setLabelRoot}
        data-node-label-layer=""
        style={{
          position: 'absolute',
          zIndex: 1000000,
          left: 0,
          top: 0,
          pointerEvents: 'none'
        }}
      />
    </NodeLabelLayerContext.Provider>
  );
};
