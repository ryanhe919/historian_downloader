/**
 * CustomTagsManager — modal CRUD UI for the user-maintained "我的标签" library.
 * Mounted from TagSidebar. All state lives in useCustomTagsStore (localStorage
 * persisted); the modal itself just talks to that store.
 *
 * Has three internal modes:
 *   - list   — table of existing tags with edit/delete/clear + "导入 CSV"
 *   - editor — single-tag create/update form
 *   - import — bulk upload: pick file, parse, preview, confirm
 */
import { useMemo, useRef, useState } from 'react'
import {
  Button,
  Empty,
  FormField,
  Icon,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  SelectOption,
  Tag,
  useToast
} from '@/components/ui'
import { buildCustomTagsCsvTemplate, parseCsv } from '@/lib/csv'
import {
  normalizeGroupPath,
  useCustomTagsStore,
  type CustomTag
} from '@/stores/customTags'
import type { TagValueType } from '@shared/domain-types'

interface EditorDraft {
  name: string
  desc: string
  unit: string
  type: '' | TagValueType
  group: string
}

const EMPTY_DRAFT: EditorDraft = { name: '', desc: '', unit: '', type: '', group: '' }

export interface CustomTagsManagerProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export function CustomTagsManager({
  isOpen,
  onOpenChange
}: CustomTagsManagerProps): React.JSX.Element {
  const toast = useToast()
  const items = useCustomTagsStore((s) => s.items)
  const add = useCustomTagsStore((s) => s.add)
  const update = useCustomTagsStore((s) => s.update)
  const remove = useCustomTagsStore((s) => s.remove)
  const clear = useCustomTagsStore((s) => s.clear)

  const [editingId, setEditingId] = useState<string | null>(null) // null=new, string=edit
  const [draft, setDraft] = useState<EditorDraft>(EMPTY_DRAFT)
  const [mode, setMode] = useState<'list' | 'editor' | 'import'>('list')
  const [confirmClear, setConfirmClear] = useState(false)

  // ---- CSV import state ----
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [importPreview, setImportPreview] = useState<
    Array<{
      row: number
      name: string
      desc?: string
      unit?: string
      type?: TagValueType
      group?: string
      status: 'new' | 'duplicate' | 'error'
      error?: string
    }>
  >([])

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        const g = (a.group ?? '').localeCompare(b.group ?? '')
        return g !== 0 ? g : a.name.localeCompare(b.name)
      }),
    [items]
  )

  // Collect every path+prefix in use so the "分组" input's <datalist>
  // can suggest both leaf paths and partial paths (e.g. `生产线 A`).
  const knownGroupPaths = useMemo(() => {
    const set = new Set<string>()
    for (const t of items) {
      if (!t.group) continue
      const parts = t.group.split('/')
      for (let i = 1; i <= parts.length; i++) {
        set.add(parts.slice(0, i).join('/'))
      }
    }
    return Array.from(set).sort()
  }, [items])

  const openNew = (): void => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setMode('editor')
  }

  const openEdit = (tag: CustomTag): void => {
    setEditingId(tag.id)
    setDraft({
      name: tag.name,
      desc: tag.desc ?? '',
      unit: tag.unit ?? '',
      type: tag.type ?? '',
      group: tag.group ?? ''
    })
    setMode('editor')
  }

  const handleSave = (): void => {
    const name = draft.name.trim()
    if (!name) {
      toast.error('标签名不能为空', { title: '无法保存' })
      return
    }
    const dup = items.find((t) => t.id !== editingId && t.name === name)
    if (dup) {
      toast.error(`已存在同名标签：${name}`, { title: '无法保存' })
      return
    }
    const payload = {
      name,
      desc: draft.desc.trim() || undefined,
      unit: draft.unit.trim() || undefined,
      type: draft.type === '' ? undefined : draft.type,
      group: normalizeGroupPath(draft.group)
    }
    if (editingId) {
      update(editingId, payload)
      toast.success(`${name} 已更新`, { title: '标签已保存' })
    } else {
      add(payload)
      toast.success(`${name} 已添加`, { title: '标签已保存' })
    }
    setMode('list')
  }

  const handleDelete = (tag: CustomTag): void => {
    remove(tag.id)
    toast.show({ status: 'info', title: '已删除', description: tag.name, duration: 2500 })
  }

  const handleClear = (): void => {
    clear()
    setConfirmClear(false)
    setMode('list')
    toast.show({ status: 'info', title: '已清空标签库', duration: 2500 })
  }

  const openImport = (): void => {
    setMode('import')
    setImportFileName('')
    setImportPreview([])
  }

  const handlePickFile = (): void => {
    fileInputRef.current?.click()
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    // Reset the input so the same filename can be re-selected after editing.
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const { headers, rows } = parseCsv(text)
      if (!headers.includes('name')) {
        setImportFileName(file.name)
        setImportPreview([])
        toast.error('CSV 表头必须包含 name 列', { title: '解析失败' })
        return
      }
      const existingNames = new Set(items.map((t) => t.name))
      const seenInFile = new Set<string>()
      const preview = rows.map((row, idx) => {
        const name = (row['name'] ?? '').trim()
        const desc = (row['desc'] ?? '').trim() || undefined
        const unit = (row['unit'] ?? '').trim() || undefined
        const group = normalizeGroupPath(row['group'])
        const rawType = (row['type'] ?? '').trim()
        let type: TagValueType | undefined
        if (rawType === '' || rawType.toLowerCase() === 'none') {
          type = undefined
        } else if (rawType.toLowerCase() === 'analog') {
          type = 'Analog'
        } else if (rawType.toLowerCase() === 'digital') {
          type = 'Digital'
        } else {
          return {
            row: idx + 2,
            name,
            desc,
            unit,
            type: undefined,
            group,
            status: 'error' as const,
            error: `无效的 type: ${rawType}（仅支持 Analog / Digital / 空）`
          }
        }
        if (!name) {
          return {
            row: idx + 2,
            name,
            desc,
            unit,
            type,
            group,
            status: 'error' as const,
            error: 'name 列不能为空'
          }
        }
        if (existingNames.has(name) || seenInFile.has(name)) {
          return {
            row: idx + 2,
            name,
            desc,
            unit,
            type,
            group,
            status: 'duplicate' as const
          }
        }
        seenInFile.add(name)
        return { row: idx + 2, name, desc, unit, type, group, status: 'new' as const }
      })
      setImportFileName(file.name)
      setImportPreview(preview)
    } catch (err) {
      toast.error((err as Error).message, { title: 'CSV 读取失败' })
    }
  }

  const handleImportConfirm = (): void => {
    const toAdd = importPreview.filter((p) => p.status === 'new')
    for (const p of toAdd) {
      add({ name: p.name, desc: p.desc, unit: p.unit, type: p.type, group: p.group })
    }
    const skipped = importPreview.filter((p) => p.status !== 'new').length
    toast.success(
      `导入 ${toAdd.length} 个自定义标签${skipped > 0 ? `（跳过 ${skipped} 个）` : ''}`,
      { title: 'CSV 导入完成' }
    )
    setMode('list')
    setImportFileName('')
    setImportPreview([])
  }

  const handleDownloadTemplate = (): void => {
    const csv = buildCustomTagsCsvTemplate()
    // Prefix BOM so Excel opens it as UTF-8 instead of GBK and mangles
    // Chinese in the `desc` column.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'custom-tags-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const importNewCount = importPreview.filter((p) => p.status === 'new').length
  const importDupCount = importPreview.filter((p) => p.status === 'duplicate').length
  const importErrCount = importPreview.filter((p) => p.status === 'error').length

  return (
    <>
      <Modal
        isOpen={isOpen}
        onOpenChange={(open) => {
          onOpenChange(open)
          if (!open) {
            // Reset modal-local editor state on close so next open starts fresh.
            setMode('list')
            setEditingId(null)
            setDraft(EMPTY_DRAFT)
          }
        }}
        size="md"
      >
        <ModalHeader>
          {mode === 'editor'
            ? editingId
              ? '编辑自定义标签'
              : '新建自定义标签'
            : mode === 'import'
              ? '批量导入 CSV'
              : '维护我的标签'}
        </ModalHeader>

        {mode === 'list' ? (
          <>
            <ModalBody>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--fg3)' }}>
                  共 {items.length} 个自定义标签，保存在本机浏览器（localStorage）
                </div>
                <div style={{ flex: 1 }} />
                <Button
                  size="sm"
                  variant="bordered"
                  startIcon={<Icon name="download" size={12} />}
                  onClick={openImport}
                >
                  导入 CSV
                </Button>
                <Button
                  size="sm"
                  color="primary"
                  startIcon={<Icon name="plus" size={12} />}
                  onClick={openNew}
                >
                  新建
                </Button>
                {items.length > 0 && (
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    startIcon={<Icon name="trash" size={12} />}
                    onClick={() => setConfirmClear(true)}
                  >
                    全部清空
                  </Button>
                )}
              </div>

              {sorted.length === 0 ? (
                <Empty
                  variant="inline"
                  image="no-data"
                  title="还没有自定义标签"
                  description={'点击 "新建" 开始维护你的常用标签'}
                />
              ) : (
                <table className="t">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>分组</th>
                      <th>标签名</th>
                      <th>描述</th>
                      <th style={{ width: 80 }}>类型</th>
                      <th style={{ width: 80 }}>单位</th>
                      <th style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((t) => (
                      <tr key={t.id}>
                        <td
                          style={{
                            maxWidth: 140,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: 12,
                            color: t.group ? 'var(--fg2)' : 'var(--fg3)'
                          }}
                          title={t.group ?? '(未分组)'}
                        >
                          {t.group ?? '—'}
                        </td>
                        <td>
                          <span className="mono" style={{ color: 'var(--fg1)', fontSize: 12 }}>
                            {t.name}
                          </span>
                        </td>
                        <td
                          style={{
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                          title={t.desc ?? ''}
                        >
                          {t.desc ?? '—'}
                        </td>
                        <td>
                          {t.type ? (
                            <Tag
                              size="sm"
                              variant="soft"
                              color={t.type === 'Analog' ? 'primary' : 'secondary'}
                            >
                              {t.type}
                            </Tag>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="mono">{t.unit || '—'}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`编辑 ${t.name}`}
                            onClick={() => openEdit(t)}
                          >
                            <Icon name="settings" size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn--danger"
                            aria-label={`删除 ${t.name}`}
                            onClick={() => handleDelete(t)}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="bordered" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
            </ModalFooter>
          </>
        ) : mode === 'import' ? (
          <>
            <ModalBody>
              <div
                style={{
                  padding: '10px 12px',
                  marginBottom: 12,
                  background: 'var(--tint-primary-weak)',
                  border: '1px solid var(--tint-primary-border)',
                  borderRadius: 10,
                  fontSize: 12,
                  color: 'var(--fg2)',
                  lineHeight: 1.6
                }}
              >
                <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--fg1)', marginBottom: 4 }}>
                  CSV 格式
                </div>
                <div>
                  第一行为表头；列：<code className="mono">name</code> (必填) ·{' '}
                  <code className="mono">desc</code> · <code className="mono">unit</code> ·{' '}
                  <code className="mono">type</code> (Analog / Digital / 空) ·{' '}
                  <code className="mono">group</code> (可选，用 <code>/</code> 分层，如{' '}
                  <code>生产线 A/水泵</code>)
                </div>
                <div style={{ marginTop: 6 }}>
                  <Button
                    size="sm"
                    variant="light"
                    startIcon={<Icon name="download" size={12} />}
                    onClick={handleDownloadTemplate}
                  >
                    下载模板
                  </Button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Button
                  size="sm"
                  color="primary"
                  variant="bordered"
                  startIcon={<Icon name="folder" size={12} />}
                  onClick={handlePickFile}
                >
                  {importFileName ? '重新选择文件' : '选择 CSV 文件'}
                </Button>
                {importFileName && (
                  <span className="mono" style={{ fontSize: 12, color: 'var(--fg3)' }}>
                    {importFileName}
                  </span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={(e) => void handleFile(e)}
              />

              {importPreview.length > 0 && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      gap: 14,
                      marginBottom: 10,
                      fontSize: 12,
                      color: 'var(--fg2)'
                    }}
                  >
                    <span>
                      共 <strong>{importPreview.length}</strong> 行
                    </span>
                    <span style={{ color: 'var(--c-success)' }}>
                      新增 <strong>{importNewCount}</strong>
                    </span>
                    {importDupCount > 0 && (
                      <span style={{ color: 'var(--fg3)' }}>
                        重复 <strong>{importDupCount}</strong>
                      </span>
                    )}
                    {importErrCount > 0 && (
                      <span style={{ color: 'var(--c-danger)' }}>
                        错误 <strong>{importErrCount}</strong>
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      maxHeight: 260,
                      overflow: 'auto',
                      border: '1px solid var(--border-default)',
                      borderRadius: 8
                    }}
                  >
                    <table className="t" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 48 }}>行</th>
                          <th style={{ width: 120 }}>分组</th>
                          <th>标签名</th>
                          <th>描述</th>
                          <th style={{ width: 70 }}>类型</th>
                          <th style={{ width: 70 }}>单位</th>
                          <th style={{ width: 90 }}>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.map((p, i) => (
                          <tr key={i}>
                            <td className="mono">{p.row}</td>
                            <td
                              style={{
                                maxWidth: 120,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontSize: 12,
                                color: p.group ? 'var(--fg2)' : 'var(--fg3)'
                              }}
                              title={p.group ?? ''}
                            >
                              {p.group ?? '—'}
                            </td>
                            <td
                              className="mono"
                              style={{ fontSize: 12, color: 'var(--fg1)' }}
                              title={p.name}
                            >
                              {p.name || '—'}
                            </td>
                            <td
                              style={{
                                maxWidth: 180,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={p.desc ?? ''}
                            >
                              {p.desc ?? '—'}
                            </td>
                            <td>{p.type ?? '—'}</td>
                            <td className="mono">{p.unit ?? '—'}</td>
                            <td>
                              {p.status === 'new' && (
                                <Tag size="sm" variant="soft" color="success">
                                  新增
                                </Tag>
                              )}
                              {p.status === 'duplicate' && (
                                <Tag size="sm" variant="soft" color="neutral">
                                  重复
                                </Tag>
                              )}
                              {p.status === 'error' && (
                                <span title={p.error}>
                                  <Tag size="sm" variant="soft" color="danger">
                                    错误
                                  </Tag>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importErrCount > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        color: 'var(--c-danger)',
                        lineHeight: 1.5
                      }}
                    >
                      有 {importErrCount} 行存在错误，导入时会自动跳过：
                      {importPreview
                        .filter((p) => p.status === 'error')
                        .slice(0, 3)
                        .map((p) => ` 第 ${p.row} 行 (${p.error})`)
                        .join('；')}
                      {importErrCount > 3 ? ' …' : ''}
                    </div>
                  )}
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="bordered" onClick={() => setMode('list')}>
                返回
              </Button>
              <Button
                color="primary"
                onClick={handleImportConfirm}
                disabled={importNewCount === 0}
              >
                导入 {importNewCount > 0 ? importNewCount : ''} 个
              </Button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalBody>
              <FormField label="标签名">
                <Input
                  value={draft.name}
                  onChange={(v) => setDraft({ ...draft, name: v })}
                  placeholder="例如：FIC-1001.PV（区分大小写）"
                  aria-label="标签名"
                  autoFocus
                  className="mono"
                />
              </FormField>
              <div style={{ height: 12 }} />
              <FormField label="描述（可选）">
                <Input
                  value={draft.desc}
                  onChange={(v) => setDraft({ ...draft, desc: v })}
                  placeholder="例如：1 号反应釜进料流量"
                  aria-label="描述"
                />
              </FormField>
              <div style={{ height: 12 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormField label="单位（可选）">
                  <Input
                    value={draft.unit}
                    onChange={(v) => setDraft({ ...draft, unit: v })}
                    placeholder="例如：m³/h"
                    aria-label="单位"
                    className="mono"
                  />
                </FormField>
                <FormField label="类型（可选）">
                  <Select
                    value={draft.type}
                    onChange={(v) => setDraft({ ...draft, type: v as EditorDraft['type'] })}
                    aria-label="类型"
                  >
                    <SelectOption value="">未指定</SelectOption>
                    <SelectOption value="Analog">Analog</SelectOption>
                    <SelectOption value="Digital">Digital</SelectOption>
                  </Select>
                </FormField>
              </div>
              <div style={{ height: 12 }} />
              <FormField label="分组（可选）">
                <>
                  <input
                    list="hd-custom-group-paths"
                    value={draft.group}
                    onChange={(e) => setDraft({ ...draft, group: e.target.value })}
                    placeholder="例如：生产线 A/水泵（用 / 分层）"
                    aria-label="分组"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                      border: '1px solid var(--border-default)',
                      borderRadius: 8,
                      background: 'var(--bg-surface)',
                      color: 'var(--fg1)',
                      outline: 'none'
                    }}
                  />
                  <datalist id="hd-custom-group-paths">
                    {knownGroupPaths.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </>
              </FormField>
            </ModalBody>
            <ModalFooter>
              <Button variant="bordered" onClick={() => setMode('list')}>
                返回
              </Button>
              <Button color="primary" onClick={handleSave} disabled={!draft.name.trim()}>
                保存
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>

      <Modal
        isOpen={confirmClear}
        onOpenChange={setConfirmClear}
        size="sm"
      >
        <ModalHeader>清空自定义标签库</ModalHeader>
        <ModalBody>
          <p style={{ margin: 0 }}>
            确定要清空全部 <strong>{items.length}</strong> 个自定义标签吗？此操作不可撤销。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="bordered" onClick={() => setConfirmClear(false)} autoFocus>
            取消
          </Button>
          <Button color="danger" onClick={handleClear}>
            全部清空
          </Button>
        </ModalFooter>
      </Modal>
    </>
  )
}

export default CustomTagsManager
