/**
 * Frameless Electron titlebar.
 *
 * - Left: macOS-style traffic lights. Because we don't yet ship a custom
 *   IPC bridge for window controls, they fall back to best-effort BOM
 *   calls (window.close / minimize via postMessage). Today they behave
 *   mostly as decoration on most platforms, but the markup hooks (`.traffic-dot`
 *   classes + `-webkit-app-region: no-drag`) are in place so the main
 *   process can wire them up later without touching the renderer.
 * - Center: brand (logo + wordmark) and placeholder app menu.
 * - Right: theme toggle and Tweaks drawer trigger.
 *
 * Drag region is inherited from the `.titlebar` CSS rule (`-webkit-app-region:
 * drag`); interactive children set `no-drag` locally.
 */
import { Menu, MenuItem, useToast } from '@/components/ui'
import { Icon } from '@/components/ui'
import { useTheme } from '@/hooks/useTheme'
import { useAppStore } from '@/stores/app'
import logoUrl from '@/assets/logo.png'

function handleTrafficAction(action: 'close' | 'min' | 'max'): void {
  if (typeof window === 'undefined') return
  try {
    if (action === 'close') {
      window.close()
    } else if (action === 'min') {
      // No BOM equivalent — rely on main process wiring later.
      // Keep the click handler so the button still feels interactive.
    } else {
      // `max` — likewise deferred to main process wiring.
    }
  } catch {
    /* ignore — decoration fallback */
  }
}

export function TitleBar(): React.JSX.Element {
  const { theme, toggleTheme } = useTheme()
  const setTweaksOpen = useAppStore((s) => s.setTweaksOpen)
  const toast = useToast()

  const showPending = (label: string): void => {
    toast.show({
      status: 'info',
      title: `${label} 功能预留`,
      description: '将于后续版本接入',
      duration: 2000
    })
  }

  const menuItems: { key: string; label: string }[] = [
    { key: 'file', label: '文件' },
    { key: 'edit', label: '编辑' },
    { key: 'view', label: '视图' },
    { key: 'help', label: '帮助' }
  ]

  return (
    <div className="titlebar">
      <div className="traffic" aria-label="Window controls">
        <button
          type="button"
          className="traffic-dot close"
          aria-label="关闭窗口"
          onClick={() => handleTrafficAction('close')}
        />
        <button
          type="button"
          className="traffic-dot min"
          aria-label="最小化"
          onClick={() => handleTrafficAction('min')}
        />
        <button
          type="button"
          className="traffic-dot max"
          aria-label="最大化"
          onClick={() => handleTrafficAction('max')}
        />
      </div>

      <div className="brand">
        <img src={logoUrl} alt="" />
        Historian<span className="dot">Downloader</span>
      </div>

      <div className="menu" role="menubar">
        {menuItems.map((m) => (
          <Menu
            key={m.key}
            trigger={
              <button type="button" className="menu-item" role="menuitem">
                {m.label}
              </button>
            }
          >
            <MenuItem itemKey={`${m.key}-placeholder`} onAction={() => showPending(m.label)}>
              （功能预留）
            </MenuItem>
          </Menu>
        ))}
      </div>

      <div className="spacer" />

      <div className="tb-actions">
        <button
          type="button"
          className="tb-btn"
          title={theme === 'dark' ? '切换为浅色模式' : '切换为深色模式'}
          aria-label="切换主题"
          onClick={() => toggleTheme()}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
        </button>
        <button
          type="button"
          className="tb-btn"
          title="设置"
          aria-label="打开设置"
          onClick={() => setTweaksOpen(true)}
        >
          <Icon name="settings" size={14} />
        </button>
      </div>
    </div>
  )
}

export default TitleBar
