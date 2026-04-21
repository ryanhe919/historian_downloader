/**
 * Export-pipeline error → Chinese-copy translator.
 *
 * Separated from ``DownloadStep.tsx`` so it can be imported by sibling views
 * (e.g. ``HistoryTable``) without tripping the
 * ``react-refresh/only-export-components`` lint rule, which forbids
 * component files from re-exporting plain functions.
 */
import { isRpcError } from '@/lib/rpc'
import { ErrorCode } from '@shared/error-codes'

/**
 * Translate an export-pipeline RPC failure into Chinese copy that a Chinese
 * operator will actually understand. Falls through to ``err.message`` for
 * codes we have not explicitly mapped so novel sidecar errors still surface.
 */
export function exportErrorMessage(err: unknown): string {
  if (!isRpcError(err)) return err instanceof Error ? err.message : '导出失败'
  switch (err.code) {
    case ErrorCode.INVALID_RANGE:
      return '时间范围无效'
    case ErrorCode.INVALID_SAMPLING:
      return '采样模式无效'
    case ErrorCode.INVALID_FORMAT:
      return '导出格式不支持'
    case ErrorCode.OUTPUT_DIR_UNWRITABLE:
      return `输出目录不可写：${err.message}`
    case ErrorCode.OLE_COM_UNAVAILABLE:
      return 'iFix 适配器需要在 Windows 上运行'
    case ErrorCode.TAG_NOT_FOUND:
      return '标签不存在'
    case ErrorCode.EXPORT_NOT_FOUND:
    case ErrorCode.EXPORT_ALREADY_RUNNING:
      return '任务状态已改变，请刷新队列'
    case ErrorCode.EXPORT_CANCELLED:
      return '任务已取消'
    case ErrorCode.ADAPTER_DRIVER:
      return `驱动异常：${err.message}`
    default:
      return err.message || '导出失败'
  }
}
