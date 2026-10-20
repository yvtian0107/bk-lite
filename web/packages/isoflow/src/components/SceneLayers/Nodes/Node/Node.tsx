import React, { useMemo, useState } from 'react';
import { Box, Typography, Stack } from '@mui/material';
import {
  PROJECTED_TILE_SIZE,
  DEFAULT_LABEL_HEIGHT,
  MARKDOWN_EMPTY_VALUE
} from 'src/config';
import { getTilePosition } from 'src/utils';
import { useIcon } from 'src/hooks/useIcon';
import { ViewItem } from 'src/types';
import { useModelItem } from 'src/hooks/useModelItem';
import { useDiagramVisual } from 'src/diagramOverlay/context';
import { useUiStateStore } from 'src/stores/uiStateStore';
import { ExpandableLabel } from 'src/components/Label/ExpandableLabel';
import { MarkdownEditor } from 'src/components/MarkdownEditor/MarkdownEditor';
import { NodeStatusMark } from './NodeStatusMark';

const PLATE_DETAIL_MIN_ZOOM = 0.7;

interface Props {
  node: ViewItem;
  order: number;
}

export const Node = ({ node, order }: Props) => {
  const modelItem = useModelItem(node.id);
  const status = useDiagramVisual().nodeStatus?.[node.id];
  const zoom = useUiStateStore((state) => state.zoom);
  const [hovering, setHovering] = useState(false);
  const { iconComponent } = useIcon(modelItem.icon, {
    id: node.id,
    order
  });

  const position = useMemo(() => {
    return getTilePosition({
      tile: node.tile,
      origin: 'BOTTOM'
    });
  }, [node.tile]);

  const plateTitle = status?.plateTitle?.trim() || '';
  const title = plateTitle || modelItem.name;
  const subtitle = status?.plateSubtitle?.trim() || '';
  const showSubtitle = Boolean(subtitle) && zoom >= PLATE_DETAIL_MIN_ZOOM;
  const hoverName = status?.hoverName?.trim() || '';
  const hoverModel = status?.hoverModel?.trim() || '';
  const hoverAlert = status?.hoverAlert?.trim() || '';
  const showHover = hovering && Boolean(hoverName || hoverModel || hoverAlert);
  const labelHeight = node.labelHeight ?? DEFAULT_LABEL_HEIGHT;

  const description = useMemo(() => {
    if (
      modelItem.description === undefined ||
      modelItem.description === MARKDOWN_EMPTY_VALUE
    )
      return null;

    return modelItem.description;
  }, [modelItem.description]);

  return (
    <Box
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      sx={{
        position: 'absolute',
        zIndex: order
      }}
    >
      <Box
        sx={{ position: 'absolute' }}
        style={{
          left: position.x,
          top: position.y
        }}
      >
        {(title || description || showSubtitle) && (
          <Box
            data-plate-subtitle={showSubtitle ? subtitle : ''}
            sx={{ position: 'absolute' }}
            style={{ bottom: PROJECTED_TILE_SIZE.height / 2 }}
          >
            {showHover ? (
              <Box
                data-testid="architecture-resource-hover"
                sx={{
                  position: 'absolute',
                  left: 0,
                  bottom: labelHeight + 72,
                  transform: 'translate(-50%, 0)',
                  zIndex: 6,
                  pointerEvents: 'none',
                  bgcolor: '#fff',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  px: '8px',
                  py: '6px',
                  minWidth: 120,
                  maxWidth: 220,
                  boxShadow: '0 6px 16px rgba(15, 23, 42, 0.12)',
                  fontFamily:
                    '"WenQuanYi Micro Hei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif'
                }}
              >
                {hoverName ? (
                  <Box sx={{ color: '#111827', fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>
                    {hoverName}
                  </Box>
                ) : null}
                {hoverModel ? (
                  <Box sx={{ color: '#6b7280', fontSize: 11, lineHeight: 1.35 }}>
                    {hoverModel}
                  </Box>
                ) : null}
                {hoverAlert ? (
                  <Box sx={{ color: '#92400e', fontSize: 11, lineHeight: 1.35 }}>
                    {hoverAlert}
                  </Box>
                ) : null}
              </Box>
            ) : null}
            <ExpandableLabel
              maxWidth={250}
              expandDirection="BOTTOM"
              labelHeight={labelHeight}
            >
              <Stack spacing={0.25}>
                {title && (
                  <Typography fontWeight={600}>{title}</Typography>
                )}
                {showSubtitle ? (
                  <Typography sx={{ color: '#6b7280', fontSize: 11, lineHeight: 1.3 }}>
                    {subtitle}
                  </Typography>
                ) : null}
                {modelItem.description &&
                  modelItem.description !== MARKDOWN_EMPTY_VALUE && (
                    <MarkdownEditor 
                      value={modelItem.description || ''} 
                      onChange={() => {}} 
                      readOnly 
                    />
                  )}
              </Stack>
            </ExpandableLabel>
          </Box>
        )}
        {iconComponent && (
          <Box
            sx={{
              position: 'absolute',
              pointerEvents: 'none'
            }}
          >
            {iconComponent}
          </Box>
        )}
        <NodeStatusMark nodeId={node.id} order={order} />
      </Box>
    </Box>
  );
};
