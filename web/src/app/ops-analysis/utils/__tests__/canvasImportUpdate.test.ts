import { describe, expect, it } from 'vitest';

import { canvasImportUpdatePath } from '../canvasImportUpdate';

describe('canvas import update path', () => {
  it('binds every canvas type to its own id', () => {
    expect(canvasImportUpdatePath('dashboard', 9)).toBe(
      '/operation_analysis/api/dashboard/9/import-update/',
    );
    expect(canvasImportUpdatePath('topology', 9)).toBe(
      '/operation_analysis/api/topology/9/import-update/',
    );
    expect(canvasImportUpdatePath('architecture', 9)).toBe(
      '/operation_analysis/api/architecture/9/import-update/',
    );
    expect(canvasImportUpdatePath('screen', 9)).toBe(
      '/operation_analysis/api/screen/9/import-update/',
    );
    expect(canvasImportUpdatePath('report', 9)).toBe(
      '/operation_analysis/api/report/9/import-update/',
    );
    expect(canvasImportUpdatePath('networkTopology', 9)).toBe(
      '/operation_analysis/api/network_topology/9/import-update/',
    );
  });
});
