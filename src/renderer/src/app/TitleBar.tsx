/**
 * Application menu bar — sits below the OS-native titlebar on Windows/Linux,
 * and below (inset into) the macOS hidden titlebar on darwin.
 *
 * - Left: 72px gutter on macOS to clear the native traffic-light cluster
 *   (titleBarStyle: 'hiddenInset'). Windows/Linux have a proper native
 *   titlebar above this row so no gutter is needed.
 * - Center: brand (logo + wordmark) and placeholder app menu.
 * - Right: theme toggle and Tweaks drawer trigger.
 *
 * Previously this row also drew macOS-style traffic-dot buttons on
 * Windows — but they were never wired to any IPC, so Windows users
 * couldn't minimize/maximize/close the window. The app now uses the
 * OS-native frame on Windows, so those fake dots were removed.
 */
import { Menu, MenuItem, useToast } from '@/components/ui'
import { Icon } from '@/components/ui'
import { useTheme } from '@/hooks/useTheme'
import { useAppStore } from '@/stores/app'
import logoUrl from '@/assets/logo.png'

export function TitleBar(): React.JSX.Element {
  const { theme, toggleTheme } = useTheme()
  const setTweaksOpen = useAppStore((s) => s.setTweaksOpen)
  const toast = useToast()

  const isMac = typeof window !== 'undefined' && window.hd?.platform === 'darwin'

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
      {isMac && (
        // Reserve space for the native macOS traffic-light cluster
        // (rendered by Electron via titleBarStyle: 'hiddenInset').
        <div style={{ width: 72, flexShrink: 0 }} aria-hidden />
      )}

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
