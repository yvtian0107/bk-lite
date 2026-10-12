'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { message } from 'antd';
import { useTranslation } from '@/utils/i18n';
import { downloadCsvFile } from '@/app/ops-analysis/utils/csvDocument';
import {
  buildWidgetCsvLabels,
  createWidgetCsvExport,
  describeWidgetCsvExportNotice,
  supportsWidgetCsvExport,
  type WidgetCsvExportRuntime,
} from '@/app/ops-analysis/utils/widgetCsvExport';

export interface WidgetCsvExportRequest {
  title: string;
}

export type WidgetCsvExporter = (request: WidgetCsvExportRequest) => Promise<void>;

export interface WidgetCsvExportRegistry {
  register: (widgetId: string, exporter: WidgetCsvExporter) => () => void;
  run: (widgetId: string, request: WidgetCsvExportRequest) => Promise<boolean>;
}

const WidgetCsvExportRegistryContext = createContext<WidgetCsvExportRegistry | null>(null);

export const useWidgetCsvExportRegistryState = (): WidgetCsvExportRegistry => {
  const exportersRef = useRef(new Map<string, WidgetCsvExporter>());
  return useMemo<WidgetCsvExportRegistry>(() => ({
    register: (widgetId, exporter) => {
      exportersRef.current.set(widgetId, exporter);
      return () => {
        if (exportersRef.current.get(widgetId) === exporter) {
          exportersRef.current.delete(widgetId);
        }
      };
    },
    run: async (widgetId, request) => {
      const exporter = exportersRef.current.get(widgetId);
      if (!exporter) return false;
      await exporter(request);
      return true;
    },
  }), []);
};

export const WidgetCsvExportRegistryProvider: React.FC<{
  children: React.ReactNode;
  registry?: WidgetCsvExportRegistry;
}> = ({ children, registry }) => {
  const owned = useWidgetCsvExportRegistryState();
  return (
    <WidgetCsvExportRegistryContext.Provider value={registry ?? owned}>
      {children}
    </WidgetCsvExportRegistryContext.Provider>
  );
};

export const useWidgetCsvExportRegistry = () => useContext(WidgetCsvExportRegistryContext);

export const deliverWidgetCsvExport = async (
  runtime: WidgetCsvExportRuntime,
  request: WidgetCsvExportRequest,
  t: (id: string, defaultMessage?: string, values?: Record<string, string | number>) => string,
) => {
  const outcome = await createWidgetCsvExport(
    runtime,
    request,
    buildWidgetCsvLabels((id) => t(id)),
  );
  if (outcome.kind === 'downloaded' || outcome.kind === 'truncated') {
    downloadCsvFile(outcome.filename, outcome.csv);
  }
  const notice = describeWidgetCsvExportNotice(outcome, t);
  if (!notice) return;
  if (notice.level === 'info') message.info(notice.text);
  else if (notice.level === 'warning') message.warning(notice.text);
  else message.error(notice.text);
};

export const useRegisterWidgetCsvExport = (
  widgetId: string,
  surface: string | undefined,
  chartType: string | undefined,
  getRuntime: () => WidgetCsvExportRuntime,
) => {
  const registry = useWidgetCsvExportRegistry();
  const { t } = useTranslation();
  const getRuntimeRef = useRef(getRuntime);
  getRuntimeRef.current = getRuntime;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!registry) return undefined;
    if (surface !== 'dashboard' && surface !== 'screen') return undefined;
    if (!supportsWidgetCsvExport(chartType)) return undefined;
    return registry.register(widgetId, (request) => (
      deliverWidgetCsvExport(getRuntimeRef.current(), request, tRef.current)
    ));
  }, [chartType, registry, surface, widgetId]);
};
