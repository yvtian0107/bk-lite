'use client';

import React from 'react';
import { Button, message } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import MoreActionsDropdown from '@/components/more-actions-dropdown';
import { useTranslation } from '@/utils/i18n';
import { useHomepageApi } from '@/app/ops-analysis/api/homepage';
import { useEffectiveHomepage } from '@/app/ops-analysis/context/effectiveHomepage';
import { buildOpsAnalysisViewHref } from '@/app/ops-analysis/utils/viewHref';

interface HomepageViewToolbarProps {
  dashboardId?: string;
}

const HomepageViewToolbar: React.FC<HomepageViewToolbarProps> = ({ dashboardId }) => {
  const { t } = useTranslation();
  const { applyPersonal } = useHomepageApi();
  const { refresh: refreshEffectiveHomepage } = useEffectiveHomepage();

  if (!dashboardId) {
    return null;
  }

  const pinWorkbench = async () => {
    try {
      await applyPersonal({ action: 'pin_workbench' });
      message.success(t('opsHomepage.pinWorkbenchSuccess'));
      await refreshEffectiveHomepage();
    } catch {
      // 请求层已经提示失败，这里不改地址、不改配置以外的状态。
    }
  };

  return (
    <>
      <Button
        type="link"
        icon={<ExportOutlined />}
        href={buildOpsAnalysisViewHref('dashboard', dashboardId)}
      >
        {t('opsHomepage.openInAnalysis')}
      </Button>
      <MoreActionsDropdown
        ariaLabel={t('opsHomepage.moreActions')}
        items={[
          {
            key: 'pin-workbench',
            label: t('opsHomepage.pinWorkbench'),
            onClick: () => {
              void pinWorkbench();
            },
          },
        ]}
      />
    </>
  );
};

export default HomepageViewToolbar;
