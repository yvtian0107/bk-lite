import { isScreenModeEnabled, toSearchParams, withScreenQuery } from '@/console-layout';

export const OPS_CAROUSEL_PANEL = 'carousel';

export const isCarouselPanel = (search: string | URLSearchParams | null | undefined): boolean =>
  toSearchParams(search).get('panel') === OPS_CAROUSEL_PANEL;

export const buildOpsCarouselViewHref = (
  carouselId: string | null,
  currentSearch?: string | URLSearchParams | null,
): string => {
  const params = toSearchParams(currentSearch);
  params.set('panel', OPS_CAROUSEL_PANEL);
  if (carouselId) {
    params.set('carousel', carouselId);
  } else {
    params.delete('carousel');
  }
  const query = params.toString();
  return withScreenQuery(
    `/ops-analysis/view?${query}`,
    isScreenModeEnabled(currentSearch) || isScreenModeEnabled(params),
  );
};

export const buildOpsDirectoryPanelHref = (
  currentSearch?: string | URLSearchParams | null,
): string => {
  const params = toSearchParams(currentSearch);
  params.delete('panel');
  params.delete('carousel');
  const query = params.toString();
  return withScreenQuery(
    query ? `/ops-analysis/view?${query}` : '/ops-analysis/view',
    isScreenModeEnabled(currentSearch) || isScreenModeEnabled(params),
  );
};

export const buildCarouselPlayHref = (id: number | string): string =>
  `/ops-analysis/view/play/${id}?screen=true`;
