/**
 * ConnectionForm — bottom "连接参数" panel for Step 0.
 *
 * Purely presentational: the parent ConnectionStep owns the draft state and
 * feeds it in through value/onChange. The form is reused for both "new
 * connection" and "edit selected" flows.
 */
import { useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  FormField,
  Grid,
  Icon,
  Input,
  Select,
  SelectOption,
  Switch
} from '@/components/ui'
import type { HistorianType } from '@shared/domain-types'
import type { ConnectionDraft, ConnectionFormProps } from './types'

export function ConnectionForm({
  value,
  onChange,
  onTest,
  onSave,
  testing,
  saving,
  selectedId
}: ConnectionFormProps): React.JSX.Element {
  const patch = (partial: Partial<ConnectionDraft>): void => onChange({ ...value, ...partial })

  // Track "password touched" so we don't clobber a placeholder when editing
  // (future hook for hasPassword flows; currently simple text input).
  const [, setTouched] = useState(false)

  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          fontSize: 'var(--fs-sm)',
          fontWeight: 600,
          color: 'var(--fg2)',
          marginBottom: 10,
          letterSpacing: '-0.005em'
        }}
      >
        连接参数{' '}
        {selectedId ? (
          <span className="mono" style={{ fontSize: 11 }}>
            · 编辑
          </span>
        ) : null}
      </div>
      <Card>
        <CardBody>
          <Grid columns={3} gap={16}>
            <FormField label="连接名称">
              <Input
                value={value.name}
                onChange={(v) => patch({ name: v })}
                placeholder="例如：生产线 A"
                aria-label="连接名称"
              />
            </FormField>

            <FormField label="Historian 类型">
              <Select
                value={value.type}
                onChange={(v) => patch({ type: v as HistorianType })}
                aria-label="Historian 类型"
                startContent={<Icon name="database" size={14} />}
              >
                <SelectOption value="iFix">GE iFix Historian</SelectOption>
                <SelectOption value="InTouch">Wonderware InTouch Historian</SelectOption>
              </Select>
            </FormField>

            <FormField label="主机 / IP">
              <Input
                value={value.host}
                onChange={(v) => patch({ host: v })}
                placeholder="192.168.10.21"
                aria-label="主机 / IP"
              />
            </FormField>

            <FormField label="端口">
              <Input
                type="number"
                value={value.port == null ? '' : String(value.port)}
                onChange={(v) => patch({ port: v === '' ? undefined : Number(v) })}
                placeholder="14000"
                aria-label="端口"
              />
            </FormField>

            <FormField label="用户名">
              <Input
                value={value.username ?? ''}
                onChange={(v) => patch({ username: v })}
                placeholder="historian_ro"
                isDisabled={value.windowsAuth}
                aria-label="用户名"
              />
            </FormField>

            <FormField label="密码">
              <Input
                type="password"
                value={value.password}
                onChange={(v) => {
                  setTouched(true)
                  patch({ password: v })
                }}
                placeholder={value.windowsAuth ? '(Windows 集成认证)' : '••••••••'}
                isClearable
                isDisabled={value.windowsAuth}
                aria-label="密码"
              />
            </FormField>

            <FormField label="连接超时（秒）">
              <Input
                type="number"
                value={value.timeoutS == null ? '' : String(value.timeoutS)}
                onChange={(v) => patch({ timeoutS: v === '' ? undefined : Number(v) })}
                placeholder="15"
                aria-label="连接超时"
              />
            </FormField>
          </Grid>

          <div className="divider" />

          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Switch
              size="sm"
              isSelected={value.savePassword}
              onChange={(c) => patch({ savePassword: c })}
            >
              保存凭据到本地
            </Switch>
            <Switch size="sm" isSelected={value.tls} onChange={(c) => patch({ tls: c })}>
              启用 TLS
            </Switch>
            <Switch
              size="sm"
              isSelected={value.windowsAuth}
              onChange={(c) => patch({ windowsAuth: c })}
            >
              使用 Windows 集成认证
            </Switch>
            <div style={{ flex: 1 }} />
            <Button variant="bordered" onClick={onTest} loading={testing}>
              <Icon name="zap" size={14} /> 测试连接
            </Button>
            <Button
              color="primary"
              onClick={onSave}
              loading={saving}
              disabled={!value.name.trim() || !value.host.trim()}
            >
              <Icon name="check" size={14} /> 保存
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

export default ConnectionForm
