import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { NODE_STATUS_COLOR } from 'src/diagramOverlay/colors';
import { useDiagramVisual } from 'src/diagramOverlay/context';
import type { NodeStatusLevel } from 'src/types';
import { useUiStateStore } from 'src/stores/uiStateStore';
import { ExpandableLabel } from 'src/components/Label/ExpandableLabel';
import { LabelConnector } from 'src/components/Label/Label';
import { MarkdownEditor } from 'src/components/MarkdownEditor/MarkdownEditor';
import { NodeStatusMark } from './NodeStatusMark';

const PLATE_DETAIL_MIN_ZOOM = 0.7;

const PLATE_MARK_TONE: Partial<Record<NodeStatusLevel, { bg: string; fg: string }>> = {
  warning: { bg: NODE_STATUS_COLOR.warning, fg: '#1f2937' },
  critical: { bg: NODE_STATUS_COLOR.critical, fg: '#fff' }
};

const PLATE_LABEL_TONE: Partial<
  Record<NodeStatusLevel, { bg: string; fg: string; border: string }>
> = {
  unmonitored: {
    bg: 'var(--color-fill-3)',
    fg: 'var(--color-text-3)',
    border: '1px solid var(--color-text-4)'
  },
  unknown: {
    bg: 'var(--color-fill-3)',
    fg: 'var(--color-text-3)',
    border: '1px solid var(--color-text-4)'
  },
  forbidden: {
    bg: 'var(--color-fill-3)',
    fg: 'var(--color-text-3)',
    border: '1px solid var(--color-text-4)'
  },
  invalid: {
    bg: 'color-mix(in srgb, var(--color-fail) 12%, transparent)',
    fg: 'var(--color-fail)',
    border: '1px solid color-mix(in srgb, var(--color-fail) 35%, transparent)'
  }
};

export const NodeLabelLayerContext = createContext<HTMLElement | null>(null);

/** Icon under the pointer. Geometry hit, so the icon itself stays pointer-events none. */
export const HoveredIconContext = createContext<string | null>(null);

interface Props {
  node: ViewItem;
  order: number;
}

export const Node = ({ node, order }: Props) => {
  const modelItem = useModelItem(node.id);
  const visual = useDiagramVisual();
  const status = visual.nodeStatus?.[node.id];
  const zoom = useUiStateStore((state) => state.zoom);
  const [hovering, setHovering] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const setHovered = (next: boolean) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (next) {
      setHovering(true);
      return;
    }
    hoverTimer.current = window.setTimeout(() => setHovering(false), 80);
  };
  useEffect(() => {
    return () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    };
  }, []);
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
  const viewing = visual.editorMode === 'EXPLORABLE_READONLY';
  const plateMark = viewing ? status?.plateMark?.trim() || '' : '';
  const healthyDot = viewing && status?.level === 'normal';
  const markTone = status?.level ? PLATE_MARK_TONE[status.level] : undefined;
  const labelTone = status?.level ? PLATE_LABEL_TONE[status.level] : undefined;
  const subtitle = status?.plateSubtitle?.trim() || '';
  const showSubtitle = Boolean(subtitle) && zoom >= PLATE_DETAIL_MIN_ZOOM;
  const hoveredIconId = useContext(HoveredIconContext);
  const revealed = viewing && (hovering || hoveredIconId === node.id);
  const resourceName = status?.hoverName?.trim() || '';
  const modelName = status?.hoverModel?.trim() || '';
  const modelLabel = status?.hoverModelLabel?.trim() || '';
  const statusLabel = status?.hoverStatusLabel?.trim() || '';
  const unnamedReason =
    !resourceName &&
    (status?.level === 'forbidden' || status?.level === 'invalid')
      ? status?.hint?.trim() || ''
      : '';
  // A host-supplied title replaces an empty icon name. A name the user typed stays put.
  const showFullName = revealed && Boolean(plateTitle) && Boolean(resourceName) && resourceName !== title;
  const resourceDetail = revealed && !plateTitle && resourceName && resourceName !== title
    ? resourceName
    : '';
  const modelDetail = revealed && modelName && modelName !== title && modelName !== (showFullName ? resourceName : resourceDetail)
    ? modelName
    : '';
  const quietLines = revealed
    ? [showFullName ? '' : resourceDetail, !resourceName ? unnamedReason : ''].filter(Boolean)
    : [];
  const alertLine = revealed ? status?.hoverAlert?.trim() || '' : '';
  const statusLine = alertLine || (revealed && status?.level === 'normal' ? status?.hint?.trim() || '' : '');
  const displayTitle = showFullName ? resourceName : title;
  const labelHeight = node.labelHeight ?? DEFAULT_LABEL_HEIGHT;
  const labelLayer = useContext(NodeLabelLayerContext);

  const description = useMemo(() => {
    if (
      modelItem.description === undefined ||
      modelItem.description === MARKDOWN_EMPTY_VALUE
    )
      return null;

    return modelItem.description;
  }, [modelItem.description]);

  const plate =
    title || description || showSubtitle ? (
      <Box
        data-plate-subtitle={showSubtitle ? subtitle : ''}
        data-plate-expanded={showFullName || quietLines.length > 0 || Boolean(modelDetail) || Boolean(statusLine) ? 'true' : 'false'}
        data-icon-hit={viewing ? node.id : undefined}
        // order is -(x + y). Negating it keeps the front plate above the icon and any plate behind it.
        data-icon-order={viewing ? 1_000_000 - order : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        sx={{ position: 'absolute', pointerEvents: 'auto', zIndex: revealed ? 2 : 0 }}
        style={{ left: position.x, top: position.y }}
      >
        <Box
          sx={{ position: 'absolute' }}
          style={{ bottom: PROJECTED_TILE_SIZE.height / 2 }}
        >
          <ExpandableLabel
            maxWidth={showFullName ? 280 : 250}
            expandDirection="BOTTOM"
            labelHeight={labelHeight}
            hideConnector={Boolean(labelLayer)}
          >
            <Stack spacing={0.25}>
              {(displayTitle || plateMark || healthyDot) && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: showFullName ? 'flex-start' : 'center',
                    gap: '6px',
                    minWidth: 0
                  }}
                >
                  {displayTitle ? (
                    <Typography
                      fontWeight={600}
                      sx={
                        showFullName
                          ? {
                              minWidth: 0,
                              maxWidth: 240,
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              whiteSpace: 'normal',
                              overflowWrap: 'anywhere',
                              lineHeight: 1.35
                            }
                          : {
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }
                      }
                    >
                      {displayTitle}
                    </Typography>
                  ) : null}
                  {healthyDot ? (
                    <Box
                      component="span"
                      title={status?.hint || undefined}
                      data-plate-mark="normal"
                      sx={{
                        flexShrink: 0,
                        alignSelf: 'center',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: NODE_STATUS_COLOR.normal
                      }}
                    />
                  ) : null}
                  {plateMark && markTone ? (
                    <Box
                      component="span"
                      title={status?.badgeHint || status?.hint || undefined}
                      data-plate-mark={status?.level}
                      sx={{
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxSizing: 'border-box',
                        minWidth: 16,
                        height: 16,
                        px: '4px',
                        borderRadius: '4px',
                        bgcolor: markTone.bg,
                        color: markTone.fg,
                        fontSize: 11,
                        fontWeight: 700,
                        lineHeight: 1,
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: 'tabular-nums'
                      }}
                    >
                      {plateMark}
                    </Box>
                  ) : null}
                  {plateMark && !markTone && labelTone ? (
                    <Box
                      component="span"
                      title={status?.hint || undefined}
                      data-plate-mark={status?.level}
                      sx={{
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        boxSizing: 'border-box',
                        height: 18,
                        px: '6px',
                        borderRadius: '4px',
                        border: labelTone.border,
                        bgcolor: labelTone.bg,
                        color: labelTone.fg,
                        fontSize: 11,
                        fontWeight: 500,
                        lineHeight: 1,
                        letterSpacing: '0.02em',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {plateMark}
                    </Box>
                  ) : null}
                </Box>
              )}
              {quietLines.length > 0 || modelDetail || statusLine ? (
                <>
                  {quietLines.map((line) => (
                    <Typography
                      key={line}
                      data-testid="architecture-resource-hover"
                      sx={{ color: 'var(--color-text-3)', fontSize: 11, lineHeight: 1.35 }}
                    >
                      {line}
                    </Typography>
                  ))}
                  {modelDetail ? (
                    <Typography
                      data-testid="architecture-resource-hover"
                      sx={{ color: 'var(--color-text-3)', fontSize: 11, lineHeight: 1.35 }}
                    >
                      {modelLabel ? (
                        <Box component="span" sx={{ color: 'var(--color-text-4)' }}>
                          {modelLabel}
                        </Box>
                      ) : null}
                      {modelDetail}
                    </Typography>
                  ) : null}
                  {statusLine ? (
                    <Typography
                      data-testid="architecture-plate-status"
                      sx={{ color: 'var(--color-text-3)', fontSize: 11, lineHeight: 1.35 }}
                    >
                      {statusLabel ? (
                        <Box component="span" sx={{ color: 'var(--color-text-4)' }}>
                          {statusLabel}
                        </Box>
                      ) : null}
                      {statusLine}
                    </Typography>
                  ) : null}
                </>
              ) : showSubtitle ? (
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
      </Box>
    ) : null;

  return (
    <Box
      sx={{
        position: 'absolute',
        zIndex: order
      }}
    >
      {labelLayer ? createPortal(plate, labelLayer) : plate}
      <Box
        sx={{ position: 'absolute' }}
        style={{
          left: position.x,
          top: position.y
        }}
      >
        {/* The dotted connector stays in the icon layer, so the icon covers it. */}
        {plate && labelLayer ? (
          <Box
            sx={{ position: 'absolute' }}
            style={{ bottom: PROJECTED_TILE_SIZE.height / 2 }}
          >
            <LabelConnector labelHeight={labelHeight} />
          </Box>
        ) : null}
        <NodeStatusMark nodeId={node.id} order={order} part="outline" />
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
