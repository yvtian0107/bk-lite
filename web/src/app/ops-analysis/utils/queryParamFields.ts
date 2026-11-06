export const queryParamFieldPaths = (
  params?: ReadonlyArray<{ name?: string; filterType?: string }>,
): string[][] => (params || []).flatMap((param) => (
  param.filterType === 'fixed' || !param.name ? [] : [['params', param.name]]
));
