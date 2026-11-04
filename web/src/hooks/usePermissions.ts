import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { usePermissions } from '@/context/permissions';
import { useMemo } from 'react';

const useBtnPermissions = (permissionPath?: string) => {
  const { data: session, status } = useSession();
  const currentPath = usePathname();
  const { permissions } = usePermissions();

  // Use useMemo to avoid conditional Hook calls
  const hasPermission = useMemo(() => {
    if (status === 'loading' || !session || !permissions) {
      return () => false;
    }

    const routePath = permissionPath || currentPath || '';
    const playPermissions = routePath === '/ops-analysis/view/play'
      || routePath.startsWith('/ops-analysis/view/play/')
      ? permissions['/ops-analysis/view/play'] || permissions['/ops-analysis/view'] || []
      : [];
    const routePermissions = permissions[routePath] || playPermissions;

    return (requiredPermissions: string[]): boolean => {
      const userPermissions = new Set<string>();
      routePermissions.forEach((permission: string) => {
        userPermissions.add(permission);
      });

      return requiredPermissions.some((permission) =>
        userPermissions.has(permission)
      );
    };
  }, [status, session, permissions, currentPath, permissionPath]);

  return { hasPermission };
};

export default useBtnPermissions;
