'use client';

import {
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import styles from './index.module.scss';
import { useTranslation } from '@/utils/i18n';
import { iconList } from '@/app/cmdb/utils/common';
import { message, Spin } from 'antd';
import type { DiagramItemHit, IsoflowSceneApi } from '@bk-lite/isoflow';
import { useArchitectureApi } from '@/app/ops-analysis/api/architecture';
import { useInstanceApi, useModelApi } from '@/app/cmdb/api';
import { useCanvasShareAction } from '@/app/ops-analysis/hooks/useCanvasShareAction';
import { flattenCollections } from '@isoflow/isopacks/dist/utils';
import {
  DiagramData,
  ArchitectureProps,
} from '@/app/ops-analysis/types/architecture';
import dynamic from 'next/dynamic';
import isoflowIsopack from '@isoflow/isopacks/dist/isoflow';
import ArchitectureToolbar from './components/toolbar';
import { DEFAULT_COLORS } from '@/app/ops-analysis/constants/common';
import { svgToBase64 } from '@/app/ops-analysis/utils/common';
import {
  selectCmdbIsometricIcons,
  selectIsometricIsopackIcons,
} from '@/app/ops-analysis/utils/architectureIcons';
import {
  AppViewFullscreenExit,
  useAppViewFullscreen,
} from '@/app/ops-analysis/components/appFullscreen';
import { useCanvasDraft } from '@/app/ops-analysis/hooks/useCanvasDraft';
import {
  toCanvasDraftResourceId,
  type CanvasDraftPayload,
} from '@/app/ops-analysis/api/canvasDraft';
import { bindCanvasDraftControls } from '@/app/ops-analysis/components/canvasDraftControls';
import ResourceBindingPanel from './components/resourceBindingPanel';
import ResourceDetailDrawer, {
  type ArchitectureDetailState,
} from './components/resourceDetailDrawer';
import StatusLegend from './components/statusLegend';
import {
  BINDING_SEARCH_LIMIT,
  bindingSearchMode,
  capBindingSearchHits,
  findSelectionBinding,
  flattenModelOptions,
  normalizeBindingSearchHits,
  normalizeFulltextModelPage,
  normalizeInstanceSearchPage,
  type ArchitectureBinding,
  type ModelOption,
} from './binding/model';
import {
  ARCHITECTURE_STATUS_POLL_MS,
  architectureStatusRequestMode,
  blockResourceOpen,
  buildNodeStatus,
  buildRectangleOverlays,
  collectBoundUuids,
  decideDiagramClick,
  iconBindingStats,
  rectangleIconCounts,
  type OverlayLabel,
} from './binding/status';
import { useArchitectureNodeStatus } from './binding/useNodeStatus';

const Isoflow = dynamic(
  () => import('@bk-lite/isoflow').then((mod) => ({ default: mod.Isoflow })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Spin size="large" />
      </div>
    ),
  }
);

const createArchitectureIcons = async () => {
  const cmdbIcons = await Promise.all(
    selectCmdbIsometricIcons(iconList).map(async (icon) => ({
      id: icon.id,
      name: icon.name,
      url: await svgToBase64(icon.src),
      isIsometric: true as const,
    }))
  );

  return [
    ...cmdbIcons,
    ...selectIsometricIsopackIcons(flattenCollections([isoflowIsopack])),
  ];
};

export interface ArchitectureRef {
  hasUnsavedChanges: () => boolean;
}

const Architecture = forwardRef<ArchitectureRef, ArchitectureProps>(
  ({ selectedArchitecture, shareMode = false }, ref) => {
    const { t } = useTranslation();
    const { getArchitectureDetail, saveArchitecture } = useArchitectureApi();
    const { fulltextSearchInstances, fulltextSearchByModel, searchInstances } = useInstanceApi();
    const { getModelList } = useModelApi();
    const { shareLoading, openShare } = useCanvasShareAction('architecture');
    const [diagramName, setDiagramName] = useState('');
    const [fossflowKey, setFossflowKey] = useState(0);
    const [currentModel, setCurrentModel] = useState<DiagramData | null>(null);
    const [hasUnsaved, setHasUnsaved] = useState(false);
    const [loading, setLoading] = useState(false);
    const [uniqueIcons, setUniqueIcons] = useState<any[]>([]);
    const [isEditMode, setIsEditMode] = useState(false);
    const [selection, setSelection] = useState<DiagramItemHit | null>(null);
    const [detail, setDetail] = useState<ArchitectureDetailState | null>(null);
    const [highlightId, setHighlightId] = useState<string | undefined>(undefined);
    const [highlightUnbound, setHighlightUnbound] = useState(false);
    const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
    const sceneApiRef = useRef<IsoflowSceneApi | null>(null);
    const fulltextSearchRef = useRef(fulltextSearchInstances);
    const fulltextByModelRef = useRef(fulltextSearchByModel);
    const searchInstancesRef = useRef(searchInstances);
    fulltextSearchRef.current = fulltextSearchInstances;
    fulltextByModelRef.current = fulltextSearchByModel;
    searchInstancesRef.current = searchInstances;
    const [loadedArchitectureId, setLoadedArchitectureId] = useState<
      string | null
    >(null);
    const resumeEditModeAfterFullscreenRef = useRef(false);
    const { isFullscreen, enterFullscreen, exitFullscreen } =
      useAppViewFullscreen();

    const officialSnapshotRef = useRef('');
    const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastModelUpdateRef = useRef<string>('');
    const isUpdatingRef = useRef<boolean>(false);
    const modelWriteEpochRef = useRef(0);
    const invalidatePendingModelWrite = useCallback(() => {
      modelWriteEpochRef.current += 1;
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    }, []);
    const [diagramData, setDiagramData] = useState<DiagramData>(() => {
      return {
        title: 'Untitled Diagram',
        icons: [],
        colors: DEFAULT_COLORS,
        items: [],
        views: [],
        fitToScreen: true,
      };
    });

    useEffect(() => {
      let isMounted = true;
      createArchitectureIcons().then((icons) => {
        if (isMounted) {
          setUniqueIcons(icons);
        }
      });
      return () => {
        isMounted = false;
      };
    }, []);

    useEffect(() => {
      if (uniqueIcons.length === 0) return;

      const currentArchitectureId = selectedArchitecture?.data_id;

      if (
        currentArchitectureId &&
        currentArchitectureId !== loadedArchitectureId
      ) {
        (async () => {
          try {
            setLoading(true);
            isUpdatingRef.current = true;

            setCurrentModel(null);
            setDiagramData({
              title: 'Loading...',
              icons: uniqueIcons,
              colors: DEFAULT_COLORS,
              items: [],
              views: [],
              fitToScreen: true,
            });
            const data = await getArchitectureDetail(currentArchitectureId);
            const viewSets = Array.isArray(data.view_sets)
              ? { items: [], views: [] }
              : data.view_sets || { items: [], views: [] };
            if (data) {
              const mergedData: DiagramData = {
                items: viewSets.items || [],
                views: viewSets.views || [],
                title: data.name || diagramName,
                icons: uniqueIcons,
                colors: DEFAULT_COLORS,
                fitToScreen: true,
              };

              setDiagramName(data.name || '');
              setDiagramData({ ...mergedData });
              setCurrentModel({ ...mergedData });
              setFossflowKey((prev) => prev + 1);
              setHasUnsaved(false);
              setLoadedArchitectureId(currentArchitectureId);
              setIsEditMode(false);

              invalidatePendingModelWrite();
              lastModelUpdateRef.current = JSON.stringify({
                items: viewSets.items || [],
                views: viewSets.views || [],
              });
            }
          } catch (error) {
            console.error('Load failed:', error);
            message.error(t('opsAnalysis.architecture.loadFailed'));
          } finally {
            setLoading(false);
            setTimeout(() => {
              isUpdatingRef.current = false;
            }, 1000);
          }
        })();
      } else if (!currentArchitectureId && loadedArchitectureId) {
        setCurrentModel(null);
        setDiagramData({
          title: 'Untitled Diagram',
          icons: uniqueIcons,
          colors: DEFAULT_COLORS,
          items: [],
          views: [],
          fitToScreen: true,
        });
        setFossflowKey((prev) => prev + 1);
        setHasUnsaved(false);
        setIsEditMode(false);
        setLoadedArchitectureId(null);
        lastModelUpdateRef.current = '';
      }
    }, [
      uniqueIcons,
      selectedArchitecture?.data_id,
      loadedArchitectureId,
      invalidatePendingModelWrite,
    ]);

    const architectureDraftResourceId = toCanvasDraftResourceId(
      selectedArchitecture?.data_id,
    );
    const getArchitectureDraftPayload = useCallback(
      (): CanvasDraftPayload => ({
        name: diagramName,
        view_sets: {
          items: currentModel?.items || [],
          views: currentModel?.views || [],
        },
      }),
      [currentModel?.items, currentModel?.views, diagramName],
    );
    const applyArchitectureDraftPayload = useCallback(
      (payload: CanvasDraftPayload) => {
        invalidatePendingModelWrite();
        const viewSets = (payload.view_sets || {}) as {
          items?: DiagramData['items'];
          views?: DiagramData['views'];
        };
        isUpdatingRef.current = true;
        const merged: DiagramData = {
          items: viewSets.items || [],
          views: viewSets.views || [],
          title: diagramName || 'Untitled Diagram',
          icons: uniqueIcons,
          colors: DEFAULT_COLORS,
          fitToScreen: true,
        };
        setDiagramData({ ...merged });
        setCurrentModel({ ...merged });
        setFossflowKey((prev) => prev + 1);
        setHasUnsaved(true);
        lastModelUpdateRef.current = JSON.stringify({
          items: merged.items,
          views: merged.views,
        });
        window.setTimeout(() => {
          isUpdatingRef.current = false;
        }, 0);
      },
      [diagramName, uniqueIcons, invalidatePendingModelWrite],
    );
    const architectureDraft = useCanvasDraft({
      resourceType: 'architecture',
      resourceId: architectureDraftResourceId,
      enabled: Boolean(
        isEditMode &&
          !shareMode &&
          architectureDraftResourceId &&
          !selectedArchitecture?.is_build_in,
      ),
      getPayload: getArchitectureDraftPayload,
      applyPayload: applyArchitectureDraftPayload,
    });

    const toggleEditMode = () => {
      const newEditMode = !isEditMode;
      setSelection(null);
      setIsEditMode(newEditMode);
      if (newEditMode) {
        officialSnapshotRef.current = lastModelUpdateRef.current;
        setHasUnsaved(false);
      }
    };

    const handleCancelEdit = () => {
      invalidatePendingModelWrite();
      if (officialSnapshotRef.current) {
        try {
          const parsed = JSON.parse(officialSnapshotRef.current) as {
            items?: DiagramData['items'];
            views?: DiagramData['views'];
          };
          isUpdatingRef.current = true;
          setCurrentModel((prev) =>
            prev
              ? { ...prev, items: parsed.items || [], views: parsed.views || [] }
              : prev,
          );
          setDiagramData((prev) => ({
            ...prev,
            items: parsed.items || [],
            views: parsed.views || [],
          }));
          setFossflowKey((prev) => prev + 1);
          lastModelUpdateRef.current = officialSnapshotRef.current;
          window.setTimeout(() => {
            isUpdatingRef.current = false;
          }, 0);
        } catch {
          // 进入编辑时的快照无法解析时，保持当前画面并退出编辑。
        }
      }
      setHasUnsaved(false);
      setSelection(null);
      setIsEditMode(false);
    };

    useEffect(() => {
      if (isFullscreen || !resumeEditModeAfterFullscreenRef.current) {
        return;
      }

      resumeEditModeAfterFullscreenRef.current = false;
      setIsEditMode(true);
    }, [isFullscreen]);

    const handleFullscreenToggle = useCallback(() => {
      if (isFullscreen) {
        exitFullscreen();
        return;
      }

      resumeEditModeAfterFullscreenRef.current = isEditMode;
      if (isEditMode) {
        setIsEditMode(false);
      }
      enterFullscreen();
    }, [enterFullscreen, exitFullscreen, isEditMode, isFullscreen]);

    const saveDiagram = async () => {
      if (!selectedArchitecture?.data_id || !currentModel) {
        return;
      }
      try {
        setLoading(true);

        const saveData = {
          name: diagramName,
          view_sets: {
            views: currentModel.views || [],
            items: currentModel.items || [],
          },
        };

        await saveArchitecture(selectedArchitecture.data_id, saveData);

        lastModelUpdateRef.current = JSON.stringify({
          items: currentModel.items || [],
          views: currentModel.views || [],
        });

        setHasUnsaved(false);
        setIsEditMode(false);
        message.success(t('topology.architecture.diagramSaved'));
      } catch {
        message.error(t('topology.architecture.saveFailed'));
      } finally {
        setLoading(false);
      }
    };

    const handleModelUpdated = useCallback(
      (model: DiagramData) => {
        if (isUpdatingRef.current) {
          return;
        }

        if (!selectedArchitecture?.data_id) {
          return;
        }

        try {
          const modelSnapshot = JSON.stringify({
            items: model.items || [],
            views: model.views || [],
          });

          if (modelSnapshot === lastModelUpdateRef.current) {
            return;
          }

          if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
          }

          const epoch = modelWriteEpochRef.current;
          debounceTimeoutRef.current = setTimeout(() => {
            if (epoch !== modelWriteEpochRef.current) return;

            try {
              const newModelData = {
                items: JSON.parse(JSON.stringify(model.items)) || [],
                views: JSON.parse(JSON.stringify(model.views)) || [],
              };

              setCurrentModel((prevModel) => {
                if (!prevModel) return null;
                return {
                  ...prevModel,
                  items: newModelData.items,
                  views: newModelData.views,
                };
              });
              if (isEditMode) {
                setHasUnsaved(true);
              }
              lastModelUpdateRef.current = modelSnapshot;
            } catch (error) {
              console.error('Error updating model state:', error);
            }
          }, 300);
        } catch (error) {
          console.error('Error in handleModelUpdated:', error);
        }
      },
      [selectedArchitecture?.data_id, isEditMode]
    );

    const selectedBinding = useMemo(
      () => findSelectionBinding(currentModel?.views, selection),
      [currentModel?.views, selection],
    );
    const showBindingPanel = Boolean(
      isEditMode && !shareMode && selectedBinding,
    );

    useEffect(() => {
      if (shareMode) return undefined;
      let cancelled = false;
      getModelList()
        .then((data) => {
          if (!cancelled) setModelOptions(flattenModelOptions(data));
        })
        .catch(() => {
          if (!cancelled) setModelOptions([]);
        });
      return () => {
        cancelled = true;
      };
    }, [getModelList, shareMode]);

    const diagramViews = currentModel?.views ?? diagramData.views;
    const boundUuids = useMemo(() => collectBoundUuids(diagramViews), [diagramViews]);
    const requestMode = architectureStatusRequestMode({
      shareMode,
      editMode: isEditMode,
    });
    const modelNames = useMemo(
      () => Object.fromEntries(modelOptions.map((model) => [model.model_id, model.model_name])),
      [modelOptions],
    );
    const viewStatus = useArchitectureNodeStatus({
      enabled: requestMode === 'poll',
      uuids: boundUuids,
      intervalMs: ARCHITECTURE_STATUS_POLL_MS,
    });
    const editStatus = useArchitectureNodeStatus({
      enabled: requestMode === 'once',
      uuids: boundUuids,
      intervalMs: 0,
    });
    const statusByUuid = requestMode === 'poll' ? viewStatus.byUuid : editStatus.byUuid;
    const selectedStatus = selectedBinding?.binding
      ? editStatus.byUuid[selectedBinding.binding.inst_uuid] ?? null
      : null;

    useEffect(() => {
      setDetail(null);
      setHighlightId(undefined);
      setHighlightUnbound(false);
    }, [loadedArchitectureId, isEditMode, shareMode]);

    const searchResources = useCallback(
      async (keyword: string, modelId: string) => {
        const mode = bindingSearchMode(keyword, modelId);
        if (mode === 'idle') {
          return capBindingSearchHits([], BINDING_SEARCH_LIMIT, 0);
        }
        if (mode === 'by-type') {
          const raw = await searchInstancesRef.current({
            model_id: modelId.trim(),
            query_list: [],
            page: 1,
            page_size: BINDING_SEARCH_LIMIT,
            case_sensitive: false,
          });
          const page = normalizeInstanceSearchPage(raw);
          return capBindingSearchHits(page.hits, BINDING_SEARCH_LIMIT, page.total);
        }
        if (mode === 'by-model-text') {
          const raw = await fulltextByModelRef.current({
            search: keyword.trim(),
            model_id: modelId.trim(),
            page: 1,
            page_size: BINDING_SEARCH_LIMIT,
            case_sensitive: false,
          });
          const page = normalizeFulltextModelPage(raw, BINDING_SEARCH_LIMIT);
          return capBindingSearchHits(page.hits, page.limit, page.total);
        }
        const raw = await fulltextSearchRef.current({
          search: keyword.trim(),
          case_sensitive: false,
        });
        const hits = normalizeBindingSearchHits(raw);
        return capBindingSearchHits(hits, BINDING_SEARCH_LIMIT, hits.length);
      },
      [],
    );

    const patchSelection = useCallback(
      (updates: { bkBinding?: ArchitectureBinding; bkFollowAlert?: boolean }) => {
        if (!selection || !sceneApiRef.current) return;
        if (selection.type === 'ITEM') {
          sceneApiRef.current.updateViewItem(selection.id, updates);
          return;
        }
        if (selection.type === 'RECTANGLE') {
          sceneApiRef.current.updateRectangle(selection.id, updates);
        }
      },
      [selection],
    );

    const handleItemSelect = useCallback((item: DiagramItemHit | null) => {
      if (!item || (item.type !== 'ITEM' && item.type !== 'RECTANGLE')) {
        setSelection(null);
        return;
      }
      setSelection(item);
    }, []);

    const alertLevelLabel = useCallback((level: string) => {
      const key: Record<string, string> = {
        fatal: 'opsAnalysis.architecture.levelFatal',
        severity: 'opsAnalysis.architecture.levelSeverity',
        critical: 'opsAnalysis.architecture.levelCritical',
        error: 'opsAnalysis.architecture.levelError',
        warning: 'opsAnalysis.architecture.levelWarning',
        remain: 'opsAnalysis.architecture.levelRemain',
      };
      const messageKey = key[level.trim().toLowerCase()];
      return messageKey ? t(messageKey) : level;
    }, [t]);

    const statusHintText = useCallback((hint: 'unmonitored' | 'unknown' | 'forbidden' | 'invalid') => {
      if (hint === 'unmonitored') return t('opsAnalysis.architecture.hintUnmonitored');
      if (hint === 'forbidden') return t('opsAnalysis.architecture.hintForbidden');
      if (hint === 'invalid') return t('opsAnalysis.architecture.hintInvalid');
      return t('opsAnalysis.architecture.hintUnknown');
    }, [t]);

    const overlayText = useCallback((label: OverlayLabel | undefined) => {
      if (!label || label.type === 'pending' || label.type === 'empty') return undefined;
      if (label.type === 'text') return label.value;
      if (label.type === 'invalid') return t('opsAnalysis.architecture.bindingInvalid');
      if (label.type === 'forbidden') return t('opsAnalysis.architecture.bindingForbidden');
      return t('opsAnalysis.architecture.bindingUnknown');
    }, [t]);

    const nodeStatus = useMemo(() => {
      if (requestMode !== 'poll') return undefined;
      if (viewStatus.phase === 'idle' && Object.keys(viewStatus.byUuid).length === 0) {
        return undefined;
      }
      const overlays = buildNodeStatus(diagramViews, viewStatus.byUuid);
      const next: Record<string, { level: 'normal' | 'warning' | 'critical' | 'unmonitored' | 'unknown' | 'invalid' | 'forbidden'; count?: number; hint?: string; badgeHint?: string }> = {};
      for (const [id, overlay] of Object.entries(overlays)) {
        const entry: { level: typeof overlay.level; count?: number; hint?: string; badgeHint?: string } = {
          level: overlay.level,
        };
        if (typeof overlay.count === 'number') entry.count = overlay.count;
        if (overlay.hint) entry.hint = statusHintText(overlay.hint);
        if (overlay.badgeName && typeof overlay.count === 'number') {
          entry.badgeHint = t('opsAnalysis.architecture.alertBadgeHint', undefined, {
            name: overlay.badgeName,
            count: overlay.count,
            level: alertLevelLabel(overlay.badgeLevel || overlay.level),
          });
        }
        next[id] = entry;
      }
      return Object.keys(next).length ? next : undefined;
    }, [
      alertLevelLabel,
      diagramViews,
      requestMode,
      statusHintText,
      t,
      viewStatus.byUuid,
      viewStatus.phase,
    ]);

    const rectangleStatus = useMemo(() => {
      if (requestMode === 'off') return undefined;
      const viewing = requestMode === 'poll';
      const source = viewing ? viewStatus.byUuid : editStatus.byUuid;
      if (viewing && viewStatus.phase === 'idle' && Object.keys(source).length === 0) {
        return undefined;
      }
      const overlays = buildRectangleOverlays(diagramViews, source, modelNames, {
        followBorders: viewing,
        markSummary: !viewing,
      });
      const next: Record<string, {
        label?: string;
        borderLevel?: 'warning' | 'critical' | 'unknown';
        badgeText?: string;
        summaryText?: string;
      }> = {};
      for (const [id, overlay] of Object.entries(overlays)) {
        const label = overlayText(overlay.label);
        const entry: {
          label?: string;
          borderLevel?: 'warning' | 'critical' | 'unknown';
          badgeText?: string;
          summaryText?: string;
        } = {};
        if (label) entry.label = label;
        if (overlay.borderLevel) entry.borderLevel = overlay.borderLevel;
        if (viewing && overlay.badgeCount) {
          entry.badgeText = t('opsAnalysis.architecture.resourceAlertBadge', undefined, {
            count: overlay.badgeCount,
          });
        }
        if (overlay.summary) entry.summaryText = t('opsAnalysis.architecture.summaryMark');
        if (entry.label || entry.borderLevel || entry.badgeText || entry.summaryText) next[id] = entry;
      }
      return Object.keys(next).length ? next : undefined;
    }, [
      diagramViews,
      editStatus.byUuid,
      modelNames,
      overlayText,
      requestMode,
      t,
      viewStatus.byUuid,
      viewStatus.phase,
    ]);

    const bindingStats = useMemo(() => iconBindingStats(diagramViews), [diagramViews]);
    const regionCounts = useMemo(() => {
      if (selection?.type !== 'RECTANGLE') return { total: 0, bound: 0 };
      return rectangleIconCounts(diagramViews, selection.id);
    }, [diagramViews, selection]);
    const nodeBinding = useMemo(() => {
      if (requestMode !== 'once') return undefined;
      const marks: Record<string, { chain?: boolean; unbound?: boolean }> = {};
      for (const id of bindingStats.boundIds) marks[id] = { chain: true };
      if (highlightUnbound) {
        for (const id of bindingStats.unboundIds) marks[id] = { unbound: true };
      }
      return Object.keys(marks).length ? marks : undefined;
    }, [bindingStats, highlightUnbound, requestMode]);

    const closeDetail = useCallback(() => {
      setDetail(null);
      setHighlightId(undefined);
    }, []);

    const handleItemClick = useCallback((item: DiagramItemHit | null) => {
      const action = decideDiagramClick({
        hit: item,
        views: diagramViews,
        statusByUuid: viewStatus.byUuid,
      });
      if (action.type === 'toast') {
        const key = action.reason === 'unbound'
          ? 'opsAnalysis.architecture.unboundNode'
          : action.reason === 'forbidden'
            ? 'opsAnalysis.architecture.bindingForbidden'
            : 'opsAnalysis.architecture.bindingInvalid';
        message.warning(t(key));
        closeDetail();
        return;
      }
      if (action.type === 'close') {
        closeDetail();
        return;
      }
      if (action.type === 'resource') {
        setHighlightId(action.highlightId);
        setDetail({
          kind: 'resource',
          instUuid: action.instUuid,
          modelId: action.modelId,
          highlightId: action.highlightId,
        });
        return;
      }
      setHighlightId(undefined);
      if (action.type === 'region') {
        setDetail({ kind: 'region', rectangleId: action.rectangleId });
        return;
      }
      setDetail({ kind: 'connector', connectorId: action.connectorId });
    }, [closeDetail, diagramViews, t, viewStatus.byUuid]);

    const openResource = useCallback((target: {
      instUuid: string;
      modelId: string;
      highlightId?: string;
    }) => {
      const blocked = blockResourceOpen(statusByUuid[target.instUuid]);
      if (blocked) return;
      setHighlightId(target.highlightId);
      setDetail((current) => ({
        kind: 'resource',
        instUuid: target.instUuid,
        modelId: target.modelId,
        highlightId: target.highlightId,
        returnTo: current && current.kind !== 'resource' ? current : undefined,
      }));
    }, [statusByUuid]);

    const backDetail = useCallback(() => {
      setHighlightId(undefined);
      setDetail((current) => (
        current && current.kind === 'resource' ? current.returnTo ?? null : null
      ));
    }, []);

    const hasUnsavedChanges = () => {
      return isEditMode && hasUnsaved;
    };

    useImperativeHandle(ref, () => ({
      hasUnsavedChanges,
    }));

    useEffect(() => {
      return () => {
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
      };
    }, []);

    return (
      <div
        className={`flex flex-col ${
          isFullscreen
            ? 'fixed inset-0 h-screen w-screen overflow-hidden p-4'
            : 'h-full flex-1 overflow-auto p-4 pb-0'
        }`}
        style={{
          backgroundColor: 'var(--color-fill-1)',
          zIndex: isFullscreen ? 1100 : undefined,
        }}
      >
        <AppViewFullscreenExit visible={isFullscreen} onExit={exitFullscreen} />
        {!isFullscreen && (
          <ArchitectureToolbar
            selectedArchitecture={selectedArchitecture}
            isEditMode={isEditMode}
            isFullscreen={isFullscreen}
            shareMode={shareMode}
            shareLoading={shareLoading}
            onOpenShare={
              !shareMode && selectedArchitecture?.data_id
                ? () => {
                  void openShare(selectedArchitecture.data_id);
                }
                : undefined
            }
            loading={loading}
            onEdit={toggleEditMode}
            onCancel={handleCancelEdit}
            onSave={saveDiagram}
            editExtra={bindCanvasDraftControls(architectureDraft)}
            onFullscreenToggle={handleFullscreenToggle}
            bindingMeter={isEditMode ? {
              bound: bindingStats.bound,
              total: bindingStats.total,
              highlightUnbound,
              onToggleHighlight: () => setHighlightUnbound((current) => !current),
            } : undefined}
          />
        )}

        <div
          className={`flex-1 relative architecture-canvas ${styles.architectureCanvas}`}
          style={{ minHeight: '500px' }}
          onContextMenu={(e) => {
            if (!isEditMode) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          {loading && (
            <div className="absolute inset-0 bg-white bg-opacity-80 flex items-center justify-center z-50">
              <Spin size="large" />
            </div>
          )}
          <Isoflow
            key={`${fossflowKey}-edit`}
            initialData={diagramData}
            onModelUpdated={handleModelUpdated}
            editorMode={shareMode || !isEditMode ? 'EXPLORABLE_READONLY' : 'EDITABLE'}
            sceneApiRef={sceneApiRef}
            onItemSelect={isEditMode && !shareMode ? handleItemSelect : undefined}
            onItemClick={requestMode === 'poll' ? handleItemClick : undefined}
            highlightedItemId={requestMode === 'poll' ? highlightId : undefined}
            nodeStatus={nodeStatus}
            nodeBinding={nodeBinding}
            rectangleStatus={rectangleStatus}
            appearancePanelTitle={t('opsAnalysis.architecture.appearancePanelTitle')}
          />
          {shareMode ? (
            <div
              data-testid="architecture-share-hint"
              className="pointer-events-none absolute right-3 top-3 z-20 rounded bg-[var(--color-fill-2)] px-2 py-1 text-xs text-[var(--color-text-3)]"
            >
              {t('opsAnalysis.architecture.shareStatusHint')}
            </div>
          ) : null}
          {requestMode === 'poll' ? <StatusLegend /> : null}
          {showBindingPanel && selectedBinding ? (
            <ResourceBindingPanel
              showFollow={selection?.type === 'RECTANGLE'}
              followAlert={selectedBinding.followAlert}
              bound={Boolean(selectedBinding.binding)}
              binding={selectedBinding.binding}
              iconTotal={regionCounts.total}
              iconBound={regionCounts.bound}
              statusLoading={Boolean(selectedBinding.binding && !selectedStatus)}
              status={selectedStatus}
              modelName={
                modelOptions.find((model) => model.model_id === selectedStatus?.model_id)?.model_name
                || selectedStatus?.model_id
                || ''
              }
              models={modelOptions}
              onSearch={searchResources}
              onBind={(hit) => {
                patchSelection({
                  bkBinding: { inst_uuid: hit.inst_uuid, model_id: hit.model_id },
                });
                message.success(t('opsAnalysis.architecture.bindingBound', undefined, {
                  name: hit.inst_name || hit.inst_uuid,
                }));
              }}
              onUnbind={() => patchSelection({ bkBinding: undefined })}
              onFollowAlert={(enabled) => patchSelection({ bkFollowAlert: enabled })}
            />
          ) : null}
          {requestMode === 'poll' && detail ? (
            <ResourceDetailDrawer
              detail={detail}
              views={diagramViews}
              items={currentModel?.items ?? diagramData.items}
              statusByUuid={viewStatus.byUuid}
              modelNames={modelNames}
              onClose={closeDetail}
              onBack={backDetail}
              onOpenResource={openResource}
            />
          ) : null}
        </div>
      </div>
    );
  }
);

Architecture.displayName = 'Architecture';

export default Architecture;
