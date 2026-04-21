/**
 * Step 3 — Download / export. Wires the global "开始下载" footer button
 * through `useAppStore.setOnStartDownload`, subscribes to server-pushed
 * progress & status events, and renders the live queue alongside the
 * history table.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Empty,
  FormField,
  Icon,
  Input,
  SegmentedControl,
  Switch,
  Tabs,
  useToast
} from '@/components/ui'
import { useRpcEvent, useRpcMutation, useRpcQuery } from '@/hooks/useRpc'
import { presetToRange } from '@/lib/time'
import { useAppStore } from '@/stores/app'
import { useConnectionStore } from '@/stores/connection'
import { useDownloadStore } from '@/stores/download'
import { useTagsStore } from '@/stores/tags'
import { useTimeRangeStore } from '@/stores/timerange'
import type { ExportFormat, ExportTask, TimeRange } from '@shared/domain-types'
import { HistoryTable } from './HistoryTable'
import { QueueRow } from './QueueRow'

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'CSV', label: 'CSV' },
  { value: 'Excel', label: 'Excel' },
  { value: 'JSON', label: 'JSON' }
]

/**
 * Tiny localStorage-backed boolean option. Keeps export preferences sticky
 * across sessions without polluting the download store.
 */
function useStickyOption(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === 'undefined') return initial
    try {
      const raw = window.localStorage.getItem(key)
      if (raw == null) return initial
      return raw === 'true'
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: boolean) => {
      setValue(v)
      try {
        window.localStorage.setItem(key, String(v))
      } catch {
        /* ignore — private mode / quota */
      }
    },
    [key]
  )
  return [value, set]
}

export function DownloadStep(): React.JSX.Element {
  const toast = useToast()

  const serverId = useConnectionStore((s) => s.selectedServerId)
  const selectedTagIds = useTagsStore((s) => s.selectedIds)

  const activePreset = useTimeRangeStore((s) => s.activePreset)
  const customRange = useTimeRangeStore((s) => s.customRange)
  const sampling = useTimeRangeStore((s) => s.sampling)
  const segmentDays = useTimeRangeStore((s) => s.segmentDays)

  const format = useDownloadStore((s) => s.format)
  const setFormat = useDownloadStore((s) => s.setFormat)
  const outputDir = useDownloadStore((s) => s.outputDir)
  const setOutputDir = useDownloadStore((s) => s.setOutputDir)
  const tasks = useDownloadStore((s) => s.tasks)
  const upsertTask = useDownloadStore((s) => s.upsertTask)
  const removeTask = useDownloadStore((s) => s.removeTask)
  const replaceTasks = useDownloadStore((s) => s.replaceTasks)

  const setOnStartDownload = useAppStore((s) => s.setOnStartDownload)

  const [splitByTag, setSplitByTag] = useStickyOption('hd.export.splitByTag', false)
  const [includeQuality, setIncludeQuality] = useStickyOption('hd.export.includeQuality', true)
  const [utf8Bom, setUtf8Bom] = useStickyOption('hd.export.utf8Bom', true)
  const [openFolderWhenDone, setOpenFolderWhenDone] = useStickyOption(
    'hd.export.openFolderWhenDone',
    true
  )

  // --- initial task list ---
  const { data: taskList, refetch: refetchTasks } = useRpcQuery('historian.export.list', undefined)
  useEffect(() => {
    if (taskList?.items) replaceTasks(taskList.items)
  }, [taskList, replaceTasks])

  // --- live events ---
  useRpcEvent('historian.export.progress', (payload) => {
    const current = useDownloadStore.getState().tasks[payload.taskId]
    if (!current) return
    upsertTask({
      ...current,
      progress: payload.progress,
      doneSegments: payload.doneSegments,
      totalSegments: payload.totalSegments,
      speedBytesPerSec: payload.speedBytesPerSec,
      sizeBytes: payload.sizeBytes,
      estimatedSizeBytes: payload.estimatedSizeBytes ?? current.estimatedSizeBytes,
      updatedAt: new Date().toISOString()
    })
  })
  useRpcEvent('historian.export.statusChanged', (payload) => {
    upsertTask(payload.task)
    if (payload.task.status === 'done' && openFolderWhenDone && payload.task.outputPath) {
      void window.hd.shell.showInFolder(payload.task.outputPath)
    }
  })

  // --- mutations ---
  const startMut = useRpcMutation('historian.export.start')
  const pauseMut = useRpcMutation('historian.export.pause')
  const resumeMut = useRpcMutation('historian.export.resume')
  const cancelMut = useRpcMutation('historian.export.cancel')

  const pickFolder = useCallback(async () => {
    try {
      const picked = await window.hd.dialog.pickFolder({
        title: '选择导出目录',
        defaultPath: outputDir
      })
      if (picked) setOutputDir(picked)
    } catch (e) {
      toast.error((e as Error).message, { title: '选择目录失败' })
    }
  }, [outputDir, setOutputDir, toast])

  const resolveRange = useCallback((): TimeRange | null => {
    if (activePreset === 'custom') return customRange ?? null
    return presetToRange(activePreset)
  }, [activePreset, customRange])

  const startDownload = useCallback(async () => {
    if (!serverId) {
      toast.warning('请先选择 Historian 服务器', { title: '无法开始' })
      return
    }
    const ids = Array.from(selectedTagIds)
    if (ids.length === 0) {
      toast.warning('请先选择至少一个标签', { title: '无法开始' })
      return
    }
    const range = resolveRange()
    if (!range) {
      toast.warning('请先设置时间范围', { title: '无法开始' })
      return
    }
    if (!outputDir) {
      toast.warning('请先选择输出目录', { title: '无法开始' })
      return
    }

    try {
      const res = await startMut.mutate({
        serverId,
        tagIds: ids,
        range,
        sampling,
        segmentDays,
        format,
        outputDir,
        options: {
          splitByTag,
          includeQuality,
          utf8Bom,
          openFolderWhenDone
        }
      })
      upsertTask(res.task)
      toast.success(`已加入队列：${res.task.name}`, { title: '任务已创建' })
    } catch (e) {
      toast.error((e as Error).message, { title: '启动失败' })
    }
  }, [
    serverId,
    selectedTagIds,
    resolveRange,
    outputDir,
    startMut,
    sampling,
    segmentDays,
    format,
    splitByTag,
    includeQuality,
    utf8Bom,
    openFolderWhenDone,
    upsertTask,
    toast
  ])

  // Publish the handler so the shell's footer button can invoke it. Restored
  // to a no-op on unmount to avoid the footer firing a stale closure.
  useEffect(() => {
    setOnStartDownload(() => {
      void startDownload()
    })
    return () => {
      setOnStartDownload(() => {
        /* no-op — DownloadStep unmounted */
      })
    }
  }, [startDownload, setOnStartDownload])

  const handlePause = useCallback(
    async (id: string) => {
      try {
        const r = await pauseMut.mutate({ taskId: id })
        upsertTask(r.task)
      } catch (e) {
        toast.error((e as Error).message, { title: '暂停失败' })
      }
    },
    [pauseMut, upsertTask, toast]
  )
  const handleResume = useCallback(
    async (id: string) => {
      try {
        const r = await resumeMut.mutate({ taskId: id })
        upsertTask(r.task)
      } catch (e) {
        toast.error((e as Error).message, { title: '继续失败' })
      }
    },
    [resumeMut, upsertTask, toast]
  )
  const handleCancel = useCallback(
    async (id: string) => {
      try {
        const r = await cancelMut.mutate({ taskId: id })
        upsertTask(r.task)
      } catch (e) {
        toast.error((e as Error).message, { title: '取消失败' })
      }
    },
    [cancelMut, upsertTask, toast]
  )
  const handleRemove = useCallback((id: string) => removeTask(id), [removeTask])
  const handleShowInFolder = useCallback((path: string) => {
    void window.hd.shell.showInFolder(path)
  }, [])

  const sortedTasks = useMemo<ExportTask[]>(() => {
    return Object.values(tasks).sort((a, b) => {
      // Running first, then paused/queued, then terminal (by updatedAt desc).
      const order = (t: ExportTask): number => {
        if (t.status === 'running') return 0
        if (t.status === 'paused') return 1
        if (t.status === 'queued') return 2
        return 3
      }
      const d = order(a) - order(b)
      if (d !== 0) return d
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    })
  }, [tasks])

  const runningCount = sortedTasks.filter((t) => t.status === 'running').length
  const defaultPlaceholder =
    window.hd?.platform === 'win32' ? 'D:\\Historian\\Exports' : '~/Historian/Exports'

  return (
    <div className="panel-inner">
      <h1 className="page-title">导出与下载</h1>
      <div className="page-sub">
        选择输出格式并启动任务。任务会按分段顺序下载，可随时暂停或取消。
      </div>

      {/* ---- Config card ---- */}
      <Card style={{ marginBottom: 16 }}>
        <CardBody>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
            <FormField label="输出格式">
              <SegmentedControl<ExportFormat>
                options={FORMAT_OPTIONS}
                value={format}
                onChange={setFormat}
                isFullWidth
              />
            </FormField>
            <FormField label="输出目录">
              <Input
                value={outputDir}
                onChange={setOutputDir}
                placeholder={defaultPlaceholder}
                startContent={<Icon name="folder" size={14} />}
                endContent={
                  <Button size="sm" variant="light" onClick={() => void pickFolder()}>
                    选择…
                  </Button>
                }
                aria-label="输出目录"
              />
            </FormField>
          </div>

          <div className="divider" />

          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Switch size="sm" isSelected={splitByTag} onChange={setSplitByTag}>
              按标签拆分为多个文件
            </Switch>
            <Switch size="sm" isSelected={includeQuality} onChange={setIncludeQuality}>
              包含质量列
            </Switch>
            <Switch size="sm" isSelected={utf8Bom} onChange={setUtf8Bom}>
              UTF-8 BOM (Excel 兼容)
            </Switch>
            <Switch size="sm" isSelected={openFolderWhenDone} onChange={setOpenFolderWhenDone}>
              完成后打开文件夹
            </Switch>
            <div style={{ flex: 1 }} />
            <Button color="primary" onClick={() => void startDownload()} loading={startMut.loading}>
              <Icon name="download" size={14} /> 开始下载
            </Button>
          </div>

          {!serverId || selectedTagIds.size === 0 ? (
            <Callout variant="info" title="请先完成前置步骤" style={{ marginTop: 12 }}>
              选择服务器（Step 0）和至少一个标签（Step 1）后即可开始下载。
            </Callout>
          ) : null}
        </CardBody>
      </Card>

      <Tabs
        variant="pills"
        defaultSelectedKey="queue"
        items={[
          {
            key: 'queue',
            label: `下载队列${sortedTasks.length ? ` · ${sortedTasks.length}` : ''}`,
            content: (
              <Card>
                <CardHeader
                  title="下载队列"
                  subtitle={sortedTasks.length > 0 ? `${runningCount} 个进行中` : '暂无任务'}
                  endContent={
                    <Button size="sm" variant="bordered" onClick={() => void refetchTasks()}>
                      <Icon name="refresh" size={12} /> 刷新
                    </Button>
                  }
                />
                <CardBody>
                  {sortedTasks.length === 0 ? (
                    <Empty
                      variant="inline"
                      image="no-data"
                      title="暂无任务"
                      description="点击上方的『开始下载』创建第一个任务"
                    />
                  ) : (
                    sortedTasks.map((task) => (
                      <QueueRow
                        key={task.id}
                        task={task}
                        onPause={(id) => void handlePause(id)}
                        onResume={(id) => void handleResume(id)}
                        onCancel={(id) => void handleCancel(id)}
                        onRemove={handleRemove}
                        onShowInFolder={handleShowInFolder}
                      />
                    ))
                  )}
                </CardBody>
              </Card>
            )
          },
          {
            key: 'history',
            label: '历史文件',
            content: (
              <Card>
                <CardHeader title="历史下载记录" subtitle="最近的导出历史" />
                <CardBody>
                  <HistoryTable />
                </CardBody>
              </Card>
            )
          }
        ]}
      />
    </div>
  )
}

export default DownloadStep
