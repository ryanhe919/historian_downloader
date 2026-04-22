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
import { exportErrorMessage } from './errors'
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
  const setStartDownloadState = useAppStore((s) => s.setStartDownloadState)

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

  // Bootstrap a sensible default output directory on first mount. The store
  // starts empty (literal ``~`` was previously leaking into the filesystem
  // as a directory named ``~``, see Wave 4 bug fix). We ask the main process
  // for Electron's ``downloads`` path joined with ``Historian`` — it is not
  // created here, only resolved; the sidecar will mkdir it at enqueue time.
  useEffect(() => {
    if (outputDir) return
    let cancelled = false
    void (async () => {
      try {
        const dir = await window.hd.paths.defaultExportDir()
        if (!cancelled && dir) setOutputDir(dir)
      } catch (e) {
        // Non-fatal — the user can still click "选择…" to pick a folder.
        console.warn('[download] defaultExportDir failed:', (e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [outputDir, setOutputDir])

  const pickFolder = useCallback(async () => {
    try {
      const picked = await window.hd.dialog.pickFolder({
        title: '选择导出目录',
        defaultPath: outputDir || undefined
      })
      // ``picked === null`` means the user hit Cancel; keep the prior value.
      if (picked) setOutputDir(picked)
    } catch (e) {
      toast.error((e as Error).message, { title: '选择目录失败' })
    }
  }, [outputDir, setOutputDir, toast])

  const resolveRange = useCallback((): TimeRange | null => {
    if (activePreset === 'custom') return customRange ?? null
    return presetToRange(activePreset)
  }, [activePreset, customRange])

  const selectedTagIdsArr = useMemo(() => Array.from(selectedTagIds), [selectedTagIds])
  const effectiveRange = useMemo(() => resolveRange(), [resolveRange])
  const prereqOk = Boolean(serverId) && selectedTagIdsArr.length > 0 && !!effectiveRange

  const startDownload = useCallback(async () => {
    // These guards mirror the inline Callouts — but are the source of truth
    // because the footer button wires directly to this handler.
    if (!serverId) {
      toast.error('请先在 Step 0 选择服务器', { title: '无法开始' })
      return
    }
    if (selectedTagIdsArr.length === 0) {
      toast.error('请先在 Step 1 选择标签', { title: '无法开始' })
      return
    }
    if (!effectiveRange) {
      toast.error('请先在 Step 2 设置时间范围', { title: '无法开始' })
      return
    }
    if (!outputDir) {
      toast.error('请先选择输出目录', { title: '无法开始' })
      return
    }

    try {
      const res = await startMut.mutate({
        serverId,
        tagIds: selectedTagIdsArr,
        range: effectiveRange,
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
      toast.error(exportErrorMessage(e), { title: '启动失败' })
    }
  }, [
    serverId,
    selectedTagIdsArr,
    effectiveRange,
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

  // Mirror loading + readiness into the app store so the FooterBar's
  // "开始下载" button can reflect them without duplicating the guard logic.
  useEffect(() => {
    setStartDownloadState({
      loading: startMut.loading,
      disabled: !prereqOk || !outputDir || startMut.loading
    })
    return () => {
      setStartDownloadState({ loading: false, disabled: true })
    }
  }, [startMut.loading, prereqOk, outputDir, setStartDownloadState])

  const handlePause = useCallback(
    async (id: string) => {
      try {
        const r = await pauseMut.mutate({ taskId: id })
        upsertTask(r.task)
      } catch (e) {
        toast.error(exportErrorMessage(e), { title: '暂停失败' })
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
        toast.error(exportErrorMessage(e), { title: '继续失败' })
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
        toast.error(exportErrorMessage(e), { title: '取消失败' })
      }
    },
    [cancelMut, upsertTask, toast]
  )
  const handleRemove = useCallback((id: string) => removeTask(id), [removeTask])
  const handleShowInFolder = useCallback(
    (path: string) => {
      void window.hd.shell.showInFolder(path).catch((e: unknown) => {
        toast.error(exportErrorMessage(e), { title: '打开失败' })
      })
    },
    [toast]
  )

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

  return (
    <div className="panel-inner">
      <h1 className="page-title">导出与下载</h1>
      <div className="page-sub">
        选择输出格式并启动任务。任务会按分段顺序下载，可随时暂停或取消。
      </div>

      {/* ---- Prerequisite guards ----
        Mirror the gating in ``startDownload`` — these Callouts tell the
        user *why* the footer "开始下载" button won't progress, whereas the
        handler itself surfaces the same message via toast.error if they
        bypass the visual hint (e.g. keyboard activation). */}
      {!serverId ? (
        <div style={{ marginBottom: 14 }}>
          <Callout variant="danger">请先在 Step 0 选择服务器</Callout>
        </div>
      ) : selectedTagIdsArr.length === 0 ? (
        <div style={{ marginBottom: 14 }}>
          <Callout variant="warning">请先在 Step 1 选择标签</Callout>
        </div>
      ) : !effectiveRange ? (
        <div style={{ marginBottom: 14 }}>
          <Callout variant="warning">请先在 Step 2 设置时间范围</Callout>
        </div>
      ) : null}

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
              {/* readOnly Input + click-anywhere-to-browse: treating the
                  whole field as a button is the Windows HIG norm for
                  file/folder pickers. The nested "选择…" Button stays as
                  a visual affordance and handles keyboard activation. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => void pickFolder()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void pickFolder()
                  }
                }}
                style={{ cursor: 'pointer' }}
                aria-label="选择输出目录"
              >
                <Input
                  className="mono"
                  value={outputDir}
                  isReadOnly
                  placeholder="点击此处选择导出目录"
                  startContent={<Icon name="folder" size={14} />}
                  endContent={
                    <Button
                      size="sm"
                      variant="light"
                      onClick={(e) => {
                        // Stop the click from bubbling to the wrapper — otherwise
                        // pickFolder fires twice (once via the Button, once via
                        // the wrapper onClick).
                        e.stopPropagation()
                        void pickFolder()
                      }}
                    >
                      选择…
                    </Button>
                  }
                  aria-label="输出目录"
                />
              </div>
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
          </div>
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
