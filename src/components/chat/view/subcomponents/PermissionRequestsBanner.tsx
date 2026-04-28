/**
 * 权限请求横幅（已停用）。
 * 授权模式锁定为 bypassPermissions，权限请求由后端自动批准，此组件不再渲染任何内容。
 */
import type { PendingPermissionRequest } from '../../types/types';

interface PermissionRequestsBannerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
}

export default function PermissionRequestsBanner(_props: PermissionRequestsBannerProps) {
  return null;
}
