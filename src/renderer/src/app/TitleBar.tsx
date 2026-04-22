/**
 * Application menu bar — sits below the OS-native titlebar on Windows/Linux,
 * and below (inset into) the macOS hidden titlebar on darwin.
 *
 * - Left: 72px gutter on macOS to clear the native traffic-light cluster
 *   (titleBarStyle: 'hiddenInset'). Windows/Linux have a proper native
 *   titlebar above this row so no gutter is needed.
 * - Center: brand (logo + wordmark) and a single "帮助" menu wiring up
 *   "检查更新" and "关于". The old 文件/编辑/视图 placeholder menus were
 *   removed — they were non-functional and only added visual noise.
 * - Right: "设置" gear opens the Tweaks drawer (which owns the theme /
 *   accent / density pickers — the old duplicate theme toggle here was
 *   removed).
 */
import { useEffect, useState } from 'react'
import {
  Button,
  Menu,
  MenuItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  useToast
} from '@/components/ui'
import { Icon } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import logoUrl from '@/assets/logo.png'
import type { UpdatePhase } from '@shared/domain-types'

export function TitleBar(): React.JSX.Element {
  const setTweaksOpen = useAppStore((s) => s.setTweaksOpen)
  const toast = useToast()

  const [aboutOpen, setAboutOpen] = useState(false)
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle')
  const [latestVersion, setLatestVersion] = useState<string | undefined>(undefined)
  const [downloadPercent, setDownloadPercent] = useState<number>(0)
  const [checking, setChecking] = useState(false)

  const isMac = typeof window !== 'undefined' && window.hd?.platform === 'darwin'
  const isWindows = typeof window !== 'undefined' && window.hd?.platform === 'win32'
  const appVersion = typeof window !== 'undefined' ? (window.hd?.appVersion ?? '') : ''

  // Subscribe to updater lifecycle events (available on Windows only; on
  // mac/linux the API exists but onStatus never fires).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.hd?.update?.onStatus) return undefined
    const off = window.hd.update.onStatus((payload) => {
      setUpdatePhase(payload.phase)
      if (payload.version) setLatestVersion(payload.version)
      if (payload.phase === 'downloading' && payload.progress) {
        setDownloadPercent(Math.round(payload.progress.percent))
      }
      if (payload.phase === 'downloaded') {
        toast.show({
          status: 'success',
          title: `已下载新版本 ${payload.version ?? ''}`,
          description: '打开帮助菜单点"立即重启并安装"完成升级',
          duration: 6000
        })
      }
      if (payload.phase === 'error' && payload.error) {
        toast.error(payload.error, { title: '自动更新错误' })
      }
    })
    return off
  }, [toast])

  const handleCheckUpdate = async (): Promise<void> => {
    if (!isWindows) {
      toast.show({
        status: 'info',
        title: '自动更新仅在 Windows 发布版本中可用',
        duration: 3000
      })
      return
    }
    if (checking) return
    setChecking(true)
    try {
      const result = await window.hd.update.check()
      if (result.updateAvailable) {
        toast.show({
          status: 'info',
          title: `发现新版本 ${result.version ?? ''}`,
          description: '正在后台下载，完成后会通知你',
          duration: 4000
        })
      } else {
        toast.show({
          status: 'success',
          title: '当前已是最新版本',
          duration: 2500
        })
      }
    } catch (err) {
      toast.error((err as Error).message, { title: '检查更新失败' })
    } finally {
      setChecking(false)
    }
  }

  const handleInstall = async (): Promise<void> => {
    try {
      await window.hd.update.install()
    } catch (err) {
      toast.error((err as Error).message, { title: '安装失败' })
    }
  }

  const helpTrigger = (
    <button type="button" className="menu-item" role="menuitem" aria-label="帮助菜单" title="帮助">
      帮助
    </button>
  )

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
        <Menu trigger={helpTrigger}>
          <MenuItem itemKey="check-update" onAction={() => void handleCheckUpdate()}>
            {checking ? '检查中…' : '检查更新'}
            {updatePhase === 'downloading' ? `（已下载 ${downloadPercent}%）` : ''}
          </MenuItem>
          {updatePhase === 'downloaded' && (
            <MenuItem itemKey="install-update" onAction={() => void handleInstall()}>
              立即重启并安装 {latestVersion ? `v${latestVersion}` : ''}
            </MenuItem>
          )}
          <MenuItem itemKey="about" onAction={() => setAboutOpen(true)}>
            关于 Historian Downloader
          </MenuItem>
        </Menu>
      </div>

      <div className="spacer" />

      <div className="tb-actions">
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

      <Modal isOpen={aboutOpen} onOpenChange={setAboutOpen} size="sm">
        <ModalHeader>关于 Historian Downloader</ModalHeader>
        <ModalBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <img src={logoUrl} alt="" width={48} height={48} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Historian Downloader</div>
              <div style={{ fontSize: 12, color: 'var(--fg3)' }}>版本 {appVersion || '—'}</div>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--fg2)' }}>
            面向 GE Proficy iFix / Wonderware InTouch Historian 的桌面导出工具。
          </p>
          {updatePhase === 'available' && latestVersion && (
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--c-primary)' }}>
              发现新版本 v{latestVersion}，正在后台下载…
            </p>
          )}
          {updatePhase === 'downloaded' && latestVersion && (
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--c-success)' }}>
              v{latestVersion} 已下载完成，可在帮助菜单中立即安装。
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="bordered" onClick={() => setAboutOpen(false)}>
            关闭
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}

export default TitleBar
