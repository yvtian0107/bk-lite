import { OBJECT_DEFAULT_ICON } from '@/app/monitor/constants';
import { encodeInstanceIdValuesParam } from '@/app/monitor/dashboards/shared/utils/instance';
import { withDashboardReturnContext } from '@/app/monitor/dashboards/shared/utils/return-navigation';
import { resolveDashboardUrl } from '@/app/monitor/dashboards/shared/utils/flow-dashboard-route';

export interface MonitorDetailLinkInput {
  monitorObjectId: string;
  name: string;
  displayName: string;
  icon?: string;
  instanceId: string;
  instanceName: string;
  instanceIdValues: string[];
  instanceIdKeys: string[];
  plugins?: Array<{ collect_type?: string; name?: string }>;
}

export function buildCmdbDetailHref(input: {
  modelId: string;
  instUuid: string;
  instName: string;
}): string {
  const params = new URLSearchParams({
    model_id: input.modelId,
    inst_uuid: input.instUuid,
    inst_name: input.instName,
  });
  return `/cmdb/assetData/detail/baseInfo?${params.toString()}`;
}

export function buildAlarmHref(monitorId: string): string {
  return `/alarm/alarms?${new URLSearchParams({ resource_id: monitorId }).toString()}`;
}

export function buildMonitorDetailHref(input: MonitorDetailLinkInput): string {
  const params = new URLSearchParams({
    monitorObjId: input.monitorObjectId,
    name: input.name,
    monitorObjDisplayName: input.displayName,
    icon: input.icon || OBJECT_DEFAULT_ICON,
    instance_id: input.instanceId,
    instance_name: input.instanceName,
    instance_id_values: encodeInstanceIdValuesParam(input.instanceIdValues),
    instance_id_keys: input.instanceIdKeys.length ? input.instanceIdKeys.join(',') : 'instance_id',
  });
  const withReturn = withDashboardReturnContext(params, {
    objectId: input.monitorObjectId,
    objectName: input.displayName || input.name,
  });
  const professional = resolveDashboardUrl({
    monitorObjectName: input.name,
    monitorObjectDisplayName: input.displayName,
    instancePlugins: input.plugins,
    queryString: withReturn.toString(),
  });
  return professional || `/monitor/view/detail?${withReturn.toString()}`;
}
