import type { ResponseFieldDefinition } from '@/app/ops-analysis/types/dataSource';
import type { TableColumnConfigItem } from '@/app/ops-analysis/types/dashBoard';

export interface TableLikePaginationState {
  current: number;
  pageSize: number;
}

export interface TableLikePagination extends TableLikePaginationState {
  total: number;
}

export interface TableLikeParseResult<RecordType extends Record<string, any>> {
  rows: RecordType[];
  pagination: TableLikePagination;
  isPaginated: boolean;
}

const isRecordArray = (value: unknown): value is Record<string, any>[] =>
  Array.isArray(value);

export const parseTableLikeData = <RecordType extends Record<string, any>>(
  rawData: unknown,
  queryPagination: TableLikePaginationState,
  supportsPagination = false,
): TableLikeParseResult<RecordType> => {
  const emptyPagination = {
    current: queryPagination.current,
    pageSize: queryPagination.pageSize,
    total: 0,
  };

  if (!rawData) {
    return {
      rows: [],
      pagination: emptyPagination,
      isPaginated: false,
    };
  }

  if (
    typeof rawData === 'object' &&
    !Array.isArray(rawData) &&
    Array.isArray((rawData as Record<string, unknown>).items)
  ) {
    const response = rawData as Record<string, unknown>;
    const items = response.items as RecordType[];
    const rawTotal = response.count !== undefined && response.count !== null && response.count !== ''
      ? response.count
      : response.total;
    const total = Number(rawTotal);
    const hasValidTotal =
      rawTotal !== undefined &&
      rawTotal !== null &&
      rawTotal !== '' &&
      Number.isFinite(total) &&
      total >= 0;
    return {
      rows: items,
      pagination: {
        current: queryPagination.current,
        pageSize: queryPagination.pageSize,
        total: hasValidTotal ? total : items.length,
      },
      isPaginated: supportsPagination && hasValidTotal,
    };
  }

  if (isRecordArray(rawData)) {
    return {
      rows: rawData as RecordType[],
      pagination: {
        current: queryPagination.current,
        pageSize: queryPagination.pageSize,
        total: rawData.length,
      },
      isPaginated: false,
    };
  }

  return {
    rows: [],
    pagination: emptyPagination,
    isPaginated: false,
  };
};

export const toDisplayFieldValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '--';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

export const getRecordEntries = (record: Record<string, unknown>) =>
  Object.entries(record).map(([key, value]) => ({
    key,
    value: toDisplayFieldValue(value),
  }));

interface TableLikeColumnConfigItem {
  key: string;
  title: string;
  visible: boolean;
  order: number;
}

export const responseFieldsOf = (rawData: unknown): ResponseFieldDefinition[] => {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return [];
  const fields = (rawData as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((field): field is ResponseFieldDefinition => (
    Boolean(field)
    && typeof field === 'object'
    && typeof (field as ResponseFieldDefinition).key === 'string'
    && (field as ResponseFieldDefinition).key.trim().length > 0
  ));
};

interface ResolveTableLikeColumnsInput<
  RecordType extends Record<string, any>,
  ColumnType extends TableLikeColumnConfigItem,
> {
  configuredColumns?: ColumnType[];
  schemaFields?: ResponseFieldDefinition[];
  responseFields?: ResponseFieldDefinition[];
  rows: RecordType[];
}

export function resolveTableLikeColumns<
  RecordType extends Record<string, any>,
  ColumnType extends TableLikeColumnConfigItem = TableColumnConfigItem,
>({
  configuredColumns = [],
  schemaFields = [],
  responseFields = [],
  rows,
}: ResolveTableLikeColumnsInput<RecordType, ColumnType>): ColumnType[] {
  const fromResponse = (fields: ResponseFieldDefinition[], start = 0): ColumnType[] =>
    fields.map(
      (field, index) =>
        ({
          key: field.key,
          title: field.title || field.key,
          visible: true,
          order: start + index,
        }) as ColumnType,
    );

  if (configuredColumns.length > 0) {
    const sorted = [...configuredColumns].sort((a, b) => a.order - b.order);
    const known = new Set(sorted.map((column) => column.key));
    const nextOrder = sorted.reduce((max, column) => Math.max(max, column.order), -1) + 1;
    const extra = fromResponse(
      responseFields.filter((field) => {
        const key = field.key.trim();
        return key && !key.startsWith('_') && !known.has(key);
      }),
      nextOrder,
    );
    return extra.length ? [...sorted, ...extra] : sorted;
  }

  if (responseFields.length > 0) {
    return fromResponse(responseFields.filter((field) => !field.key.trim().startsWith('_')));
  }

  if (schemaFields.length > 0) {
    return schemaFields.map(
      (field, index) =>
        ({
          key: field.key,
          title: field.title || field.key,
          visible: true,
          order: index,
        }) as ColumnType,
    );
  }

  if (rows.length > 0) {
    return Object.keys(rows[0]).map(
      (key, index) =>
        ({
          key,
          title: key,
          visible: true,
          order: index,
        }) as ColumnType,
    );
  }

  return [];
}
