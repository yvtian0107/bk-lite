'use client';

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useParamInputOptions } from '@/app/ops-analysis/hooks/useParamInputOptions';
import { useShareMode } from '@/app/ops-analysis/context/shareMode';
import { useShareOrganization } from '@/app/ops-analysis/context/shareOrganization';
import type { UnifiedFilterDefinition } from '@/app/ops-analysis/types/dashBoard';
import type { Group } from '@/types/index';
import { UserInfoContext } from '@/context/userInfo';
import { useTimeRangeList } from '@/constants/shared';
import { useTranslation } from '@/utils/i18n';
import {
  mapOptionLabels,
  type FilterTemplateLabels,
} from '@/app/ops-analysis/utils/filterTemplate';
import { isDynamicOptionFilter } from '@/app/ops-analysis/utils/optionBackedFilterValue';
import { isOrganizationFilterDefinition } from '@/app/ops-analysis/utils/unifiedFilterState';

const sameLabelMap = (
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
) => {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
};

const collectOrgNames = (groups: Group[] | undefined) => {
  const names: Record<string, string> = {};
  const visit = (nodes: Group[] | undefined) => {
    nodes?.forEach((group) => {
      if (group?.id != null && group.name) {
        names[String(group.id)] = group.name;
        const numeric = Number(group.id);
        if (Number.isFinite(numeric)) names[String(numeric)] = group.name;
      }
      visit(group.subGroups);
      visit(group.children);
    });
  };
  visit(groups);
  return names;
};

const DynamicOptionLabelLoader = ({
  definition,
  onUpdate,
}: {
  definition: UnifiedFilterDefinition;
  onUpdate: (filterId: string, labels: Record<string, string> | undefined) => void;
}) => {
  const state = useParamInputOptions(definition.inputConfig, {
    suppressErrorNotification: true,
  });

  useEffect(() => {
    if (state.status === 'success') {
      onUpdate(definition.id, mapOptionLabels(state.options));
      return;
    }
    if (state.status === 'error') {
      onUpdate(definition.id, {});
      return;
    }
    onUpdate(definition.id, undefined);
  }, [definition.id, onUpdate, state.options, state.status]);

  return null;
};

export const FilterDisplayLabelLoaders = ({
  definitions,
  enabled,
  onUpdate,
}: {
  definitions: UnifiedFilterDefinition[];
  enabled: boolean;
  onUpdate: (filterId: string, labels: Record<string, string> | undefined) => void;
}) => {
  if (!enabled) return null;
  return definitions
    .filter((definition) => definition.enabled && isDynamicOptionFilter(definition))
    .map((definition) => (
      <DynamicOptionLabelLoader
        key={definition.id}
        definition={definition}
        onUpdate={onUpdate}
      />
    ));
};

export const useFilterDisplayLabels = (
  definitions: UnifiedFilterDefinition[],
  enabled: boolean,
): {
  labels: FilterTemplateLabels;
  reportDynamicLabels: (filterId: string, labels: Record<string, string> | undefined) => void;
} => {
  const { t } = useTranslation();
  const shareMode = useShareMode();
  const shareOrganization = useShareOrganization();
  const userInfo = useContext(UserInfoContext);
  const timeRanges = useTimeRangeList();
  const [dynamicLabels, setDynamicLabels] = useState<Record<string, Record<string, string> | undefined>>({});

  const reportDynamicLabels = useCallback((
    filterId: string,
    nextLabels: Record<string, string> | undefined,
  ) => {
    setDynamicLabels((current) => {
      if (nextLabels === undefined) {
        if (!(filterId in current)) return current;
        const next = { ...current };
        delete next[filterId];
        return next;
      }
      if (sameLabelMap(current[filterId], nextLabels)) return current;
      return { ...current, [filterId]: nextLabels };
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const allowed = new Set(
      definitions
        .filter((definition) => definition.enabled && isDynamicOptionFilter(definition))
        .map((definition) => definition.id),
    );
    setDynamicLabels((current) => {
      const keys = Object.keys(current);
      if (keys.every((key) => allowed.has(key))) return current;
      return keys.reduce<Record<string, Record<string, string> | undefined>>((next, key) => {
        if (allowed.has(key)) next[key] = current[key];
        return next;
      }, {});
    });
  }, [definitions, enabled]);

  const timeRangeLabels = useMemo(() => {
    const next: Record<number, string> = {};
    timeRanges.forEach((item) => {
      const minutes = Number(item.value);
      if (minutes > 0 && item.label) next[minutes] = String(item.label);
    });
    return next;
  }, [timeRanges]);

  const dateRangeLabels = useMemo(() => ({
    today: t('dateRange.today'),
    yesterday: t('dateRange.yesterday'),
    this_week: t('dateRange.this_week'),
    last_week: t('dateRange.last_week'),
    this_month: t('dateRange.this_month'),
    last_month: t('dateRange.last_month'),
    last_7_days: t('dateRange.last_7_days'),
    last_30_days: t('dateRange.last_30_days'),
    last_90_days: t('dateRange.last_90_days'),
  }), [t]);

  const formatMultiSelect = useCallback((first: string, count: number) => (
    t('dashboard.filterTokenMulti', '{first} 等 {count} 项', { first, count })
  ), [t]);

  const orgNamesById = useMemo(() => {
    const needsOrg = definitions.some(
      (definition) => definition.enabled && isOrganizationFilterDefinition(definition),
    );
    if (!needsOrg) return {} as Record<string, string>;
    if (shareMode) {
      if (!shareOrganization) return undefined;
      return collectOrgNames(shareOrganization.groupTree);
    }
    if (!userInfo) return undefined;
    if (userInfo.loading && userInfo.groupTree.length === 0) return undefined;
    return collectOrgNames(userInfo.groupTree);
  }, [definitions, shareMode, shareOrganization, userInfo]);

  const labels = useMemo<FilterTemplateLabels>(() => ({
    optionLabelsByFilterId: enabled ? dynamicLabels : {},
    orgNamesById: enabled ? orgNamesById : undefined,
    timeRangeLabels: enabled ? timeRangeLabels : {},
    dateRangeLabels: enabled ? dateRangeLabels : {},
    formatMultiSelect,
  }), [
    dateRangeLabels,
    dynamicLabels,
    enabled,
    formatMultiSelect,
    orgNamesById,
    timeRangeLabels,
  ]);

  return { labels, reportDynamicLabels };
};
