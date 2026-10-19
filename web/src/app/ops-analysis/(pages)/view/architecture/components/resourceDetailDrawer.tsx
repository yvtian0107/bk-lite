'use client';

import { useState, type ComponentType, type ReactNode } from 'react';
import { Button, Spin, Tabs, Tag, message } from 'antd';
import CompactEmptyState from '@/components/compact-empty-state';
import OperateDrawer from '@/components/operate-drawer';
import { useAppWidget, useLazyAppWidget } from '@/context/appCapabilities';
import { useScreenAwareRouter } from '@/console-layout';
import { useTranslation } from '@/utils/i18n';
import useMonitorApi from '@/app/monitor/api';
import type { ArchitectureNodeStatusItem } from '../binding/model';
import {
  connectorResourceLines,
  regionResourceLines,
  resourceTitle,
  type OverlayLabel,
  type ResourceLine,
} from '../binding/status';
import { buildAlarmHref, buildCmdbDetailHref, buildMonitorDetailHref } from '../binding/links';

export type ArchitectureDetailState =
  | {
    kind: 'resource';
    instUuid: string;
    modelId: string;
    highlightId?: string;
    returnTo?: ArchitectureDetailState;
  }
  | { kind: 'region'; rectangleId: string }
  | { kind: 'connector'; connectorId: string };

interface ResourceDetailDrawerProps {
  detail: ArchitectureDetailState;
  views: unknown;
  statusByUuid: Record<string, ArchitectureNodeStatusItem>;
  modelNames: Record<string, string>;
  onClose: () => void;
  onBack: () => void;
  onOpenResource: (target: { instUuid: string; modelId: string; highlightId?: string }) => void;
}

type DetailTab = 'cmdb' | 'monitor' | 'alerts';

const TAB_LABEL: Record<DetailTab, string> = {
  cmdb: 'dashboard.applicationTopologyCmdbTab',
  monitor: 'dashboard.applicationTopologyMonitorTab',
  alerts: 'dashboard.applicationTopologyAlertTab',
};

const LEVEL_LABEL: Record<ArchitectureNodeStatusItem['status'], string> = {
  normal: 'opsAnalysis.architecture.statusNormal',
  warning: 'opsAnalysis.architecture.statusWarning',
  critical: 'opsAnalysis.architecture.statusCritical',
  unmonitored: 'opsAnalysis.architecture.statusUnmonitored',
  unknown: 'opsAnalysis.architecture.statusUnknown',
  invalid: 'opsAnalysis.architecture.bindingInvalid',
  forbidden: 'opsAnalysis.architecture.bindingForbidden',
};

const labelText = (
  title: OverlayLabel,
  t: (key: string) => string,
) => {
  if (title.type === 'text') return title.value;
  if (title.type === 'invalid') return t('opsAnalysis.architecture.bindingInvalid');
  if (title.type === 'forbidden') return t('opsAnalysis.architecture.bindingForbidden');
  if (title.type === 'empty') return t('opsAnalysis.architecture.connectorEmpty');
  if (title.type === 'unknown') return t('opsAnalysis.architecture.bindingUnknown');
  return '';
};

const levelColor = (level: ArchitectureNodeStatusItem['status']) => {
  if (level === 'critical') return 'error';
  if (level === 'warning') return 'warning';
  if (level === 'normal') return 'success';
  return 'default';
};

const ResourceDetailDrawer = ({
  detail,
  views,
  statusByUuid,
  modelNames,
  onClose,
  onBack,
  onOpenResource,
}: ResourceDetailDrawerProps) => {
  const { t } = useTranslation();
  const showBack = detail.kind === 'resource' && Boolean(detail.returnTo);
  const resource = detail.kind === 'resource' ? detail : null;
  const lines = detail.kind === 'region'
    ? regionResourceLines(views, detail.rectangleId, statusByUuid, modelNames)
    : detail.kind === 'connector'
      ? connectorResourceLines(views, detail.connectorId, statusByUuid, modelNames)
      : [];
  const status = resource ? statusByUuid[resource.instUuid] : undefined;
  const titleLabel = resource ? resourceTitle(status, modelNames) : null;
  const heading = detail.kind === 'region'
    ? t('opsAnalysis.architecture.regionTitle')
    : detail.kind === 'connector'
      ? t('opsAnalysis.architecture.connectorTitle')
      : titleLabel && titleLabel.type !== 'pending'
        ? labelText(titleLabel, t)
        : t('opsAnalysis.architecture.detailTitle');

  return (
    <OperateDrawer
      open
      width={800}
      destroyOnHidden
      title={heading}
      onClose={onClose}
      classNames={{ body: 'flex min-h-0 flex-col overflow-hidden' }}
      styles={{ body: { overflow: 'hidden', padding: 0 } }}
      footer={(
        <Button onClick={onClose}>{t('dashboard.applicationTopologyCloseDetail')}</Button>
      )}
    >
        <div data-testid="architecture-detail" className="flex min-h-0 flex-1 flex-col">
          {showBack ? (
            <div className="px-4 pt-3">
              <Button type="link" className="px-0" onClick={onBack}>
                {t('opsAnalysis.architecture.backToList')}
              </Button>
            </div>
          ) : null}
          {detail.kind === 'resource' && resource ? (
            <ResourceBody
              instUuid={resource.instUuid}
              modelId={resource.modelId}
              instName={status?.inst_name || ''}
              monitorId={status?.monitor_id || ''}
              blocked={titleLabel && (titleLabel.type === 'invalid' || titleLabel.type === 'forbidden')
                ? labelText(titleLabel, t)
                : ''}
            />
          ) : (
            <ResourceLines
              testId={detail.kind === 'region' ? 'architecture-region-list' : 'architecture-connector-detail'}
              emptyLabel={detail.kind === 'region'
                ? t('opsAnalysis.architecture.regionEmpty')
                : t('opsAnalysis.architecture.connectorEmpty')}
              endpointLabel={detail.kind === 'connector'
                ? [
                  t('opsAnalysis.architecture.endpointStart'),
                  t('opsAnalysis.architecture.endpointEnd'),
                ]
                : undefined}
              selfLabel={t('opsAnalysis.architecture.regionSelf')}
              lines={lines}
              onOpen={onOpenResource}
            />
          )}
        </div>
    </OperateDrawer>
  );
};

const ResourceLines = ({
  testId,
  emptyLabel,
  endpointLabel,
  selfLabel,
  lines,
  onOpen,
}: {
  testId: string;
  emptyLabel: string;
  endpointLabel?: string[];
  selfLabel: string;
  lines: ResourceLine[];
  onOpen: ResourceDetailDrawerProps['onOpenResource'];
}) => {
  const { t } = useTranslation();
  if (!lines.length) {
    return (
      <div data-testid={testId} className="flex min-h-[280px] flex-1 items-center justify-center">
        <CompactEmptyState description={emptyLabel} />
      </div>
    );
  }
  return (
    <div data-testid={testId} className="flex flex-col gap-2 overflow-auto px-4 py-3">
      {lines.map((line, index) => {
        const title = line.title.type === 'pending' ? '' : labelText(line.title, t);
        const prefix = line.key === 'self'
          ? selfLabel
          : endpointLabel?.[index];
        const meta = line.alertCount != null && line.title.type === 'text'
          ? t('opsAnalysis.architecture.alertCount', undefined, { count: line.alertCount })
          : '';
        const content = (
          <>
            {prefix ? (
              <div className="text-xs text-[var(--color-text-3)]">{prefix}</div>
            ) : null}
            <div className="flex items-center gap-2">
              {line.title.type === 'pending' ? <Spin size="small" /> : (
                <span className="text-sm text-[var(--color-text-1)]">{title}</span>
              )}
              {line.level && line.title.type === 'text' ? (
                <Tag color={levelColor(line.level)}>{t(LEVEL_LABEL[line.level])}</Tag>
              ) : null}
            </div>
            {meta && line.title.type !== 'empty' ? (
              <div className="text-xs text-[var(--color-text-3)]">{meta}</div>
            ) : null}
          </>
        );
        if (!line.clickable) {
          return (
            <div
              key={line.key}
              data-testid={`architecture-resource-row-${line.key}`}
              className="rounded border border-[var(--color-border-2)] px-3 py-2"
            >
              {content}
            </div>
          );
        }
        return (
          <button
            key={line.key}
            type="button"
            data-testid={`architecture-resource-row-${line.key}`}
            className="rounded border border-[var(--color-border-2)] px-3 py-2 text-left hover:bg-[var(--color-fill-2)]"
            onClick={() => onOpen({
              instUuid: line.instUuid,
              modelId: line.modelId,
              highlightId: line.highlightId,
            })}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
};

const ResourceBody = ({
  instUuid,
  modelId,
  instName,
  monitorId,
  blocked,
}: {
  instUuid: string;
  modelId: string;
  instName: string;
  monitorId: string;
  blocked: string;
}) => {
  const { t } = useTranslation();
  const router = useScreenAwareRouter();
  const { lookupInstance, getEffectivePlugins } = useMonitorApi();
  const [tab, setTab] = useState<DetailTab>('cmdb');
  const [headerAction, setHeaderAction] = useState<ReactNode>(null);
  const [openingMonitor, setOpeningMonitor] = useState(false);
  const baseInfo = useAppWidget('cmdb.baseInfo');
  const monitorView = useAppWidget('monitor.monitorView');
  const alertList = useAppWidget('monitor.alertList');
  const tabs: DetailTab[] = [];
  if (baseInfo.declared) tabs.push('cmdb');
  if (monitorView.declared) tabs.push('monitor');
  if (alertList.declared) tabs.push('alerts');
  const waiting = tabs.length === 0 && [baseInfo, monitorView, alertList].some(
    (widget) => widget.status === 'loading',
  );
  const activeTab = tabs.includes(tab) ? tab : tabs[0];
  const monitorReady = Boolean(monitorId);
  const baseWidget = useLazyAppWidget({
    loadWidget: baseInfo.loadWidget,
    active: activeTab === 'cmdb',
  });
  const monitorWidget = useLazyAppWidget({
    loadWidget: monitorReady ? monitorView.loadWidget : null,
    active: monitorReady && activeTab === 'monitor',
  });
  const alertWidget = useLazyAppWidget({
    loadWidget: monitorReady ? alertList.loadWidget : null,
    active: monitorReady && activeTab === 'alerts',
  });
  const BaseInfo = baseWidget.Widget as ComponentType<{
    instUuid: string;
    onHeaderAction?: (action: ReactNode) => void;
  }> | null;
  const MonitorView = monitorWidget.Widget as ComponentType<{ monitorId: string }> | null;
  const AlertList = alertWidget.Widget as ComponentType<{
    monitorId: string;
    occurredAtField?: 'start_event_time';
  }> | null;

  const openMonitor = async () => {
    setOpeningMonitor(true);
    try {
      const lookup = await lookupInstance({ instance_id: monitorId });
      const object = lookup?.monitor_object;
      const instance = lookup?.instance;
      if (object?.id == null || !instance) {
        message.error(t('opsAnalysis.architecture.loadFailed'));
        return;
      }
      const plugins = await getEffectivePlugins(object.id, { instance_id: monitorId });
      const pluginList = Array.isArray(plugins) ? plugins : [];
      const instanceId = String(instance.instance_id || monitorId);
      const instanceKeys = instance.instance_id_keys?.length
        ? instance.instance_id_keys
        : object.instance_id_keys?.length
          ? object.instance_id_keys
          : ['instance_id'];
      router.push(buildMonitorDetailHref({
        monitorObjectId: String(object.id),
        name: String(object.name || object.display_name || ''),
        displayName: String(object.display_name || object.name || ''),
        icon: object.icon,
        instanceId,
        instanceName: String(instance.instance_name || instance.name || instName || instanceId),
        instanceIdValues: instance.instance_id_values?.length ? instance.instance_id_values : [instanceId],
        instanceIdKeys: instanceKeys,
        plugins: pluginList.map((plugin) => ({
          name: typeof plugin?.name === 'string' ? plugin.name : undefined,
          collect_type: typeof plugin?.collect_type === 'string' ? plugin.collect_type : undefined,
        })),
      }));
    } catch {
      message.error(t('opsAnalysis.architecture.loadFailed'));
    } finally {
      setOpeningMonitor(false);
    }
  };

  if (blocked) {
    return (
      <div className="flex min-h-[280px] flex-1 items-center justify-center">
        <CompactEmptyState description={blocked} />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 px-4 pt-3">
        {modelId ? (
          <Button
            size="small"
            onClick={() => router.push(buildCmdbDetailHref({
              modelId,
              instUuid,
              instName,
            }))}
          >
            {t('opsAnalysis.architecture.linkCmdb')}
          </Button>
        ) : null}
        {monitorId ? (
          <Button size="small" loading={openingMonitor} onClick={() => void openMonitor()}>
            {t('opsAnalysis.architecture.linkMonitor')}
          </Button>
        ) : null}
        {monitorId ? (
          <Button size="small" onClick={() => router.push(buildAlarmHref(monitorId))}>
            {t('opsAnalysis.architecture.linkAlarm')}
          </Button>
        ) : null}
      </div>
      {waiting ? (
        <div className="flex min-h-[280px] flex-1 items-center justify-center">
          <Spin />
        </div>
      ) : tabs.length === 0 ? (
        <div className="flex min-h-[280px] flex-1 items-center justify-center">
          <CompactEmptyState description={t('dashboard.applicationTopologyWidgetUnavailable')} />
        </div>
      ) : (
        <>
          <Tabs
            className="shrink-0 px-4 [&_.ant-tabs-nav]:mb-0"
            activeKey={activeTab}
            items={tabs.map((key) => ({ key, label: t(TAB_LABEL[key]) }))}
            onChange={(value) => {
              setHeaderAction(null);
              setTab(value as DetailTab);
            }}
            tabBarExtraContent={activeTab === 'cmdb' ? headerAction : null}
          />
          <div className="min-h-0 flex-1 overflow-auto px-4 pt-3 pb-4">
            {activeTab === 'cmdb' ? (
              <WidgetSlot
                declared={baseInfo.declared}
                loading={baseInfo.status === 'loading' || (baseInfo.declared && !BaseInfo && !baseWidget.loadFailed)}
                failed={baseWidget.loadFailed}
              >
                {BaseInfo ? <BaseInfo instUuid={instUuid} onHeaderAction={setHeaderAction} /> : null}
              </WidgetSlot>
            ) : null}
            {activeTab === 'monitor' || activeTab === 'alerts' ? (
              monitorId ? (
                <WidgetSlot
                  declared={activeTab === 'monitor' ? monitorView.declared : alertList.declared}
                  loading={
                    (activeTab === 'monitor' ? monitorView.status : alertList.status) === 'loading'
                    || (activeTab === 'monitor'
                      ? monitorView.declared && !MonitorView && !monitorWidget.loadFailed
                      : alertList.declared && !AlertList && !alertWidget.loadFailed)
                  }
                  failed={activeTab === 'monitor' ? monitorWidget.loadFailed : alertWidget.loadFailed}
                >
                  {activeTab === 'monitor' && MonitorView ? <MonitorView monitorId={monitorId} /> : null}
                  {activeTab === 'alerts' && AlertList ? (
                    <AlertList monitorId={monitorId} occurredAtField="start_event_time" />
                  ) : null}
                </WidgetSlot>
              ) : (
                <div className="flex h-40 items-center justify-center">
                  <CompactEmptyState description={t('dashboard.applicationTopologyUnmonitored')} />
                </div>
              )
            ) : null}
          </div>
        </>
      )}
    </>
  );
};

const WidgetSlot = ({
  declared,
  loading,
  failed,
  children,
}: {
  declared: boolean;
  loading: boolean;
  failed: boolean;
  children: ReactNode;
}) => {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spin />
      </div>
    );
  }
  if (!declared || failed) {
    return (
      <div className="flex h-40 items-center justify-center">
        <CompactEmptyState description={t('dashboard.applicationTopologyWidgetUnavailable')} />
      </div>
    );
  }
  return <>{children}</>;
};

export default ResourceDetailDrawer;
