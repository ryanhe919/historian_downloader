/**
 * TweaksPanel — right-side drawer exposing theme / accent / density
 * preferences. All three values live in the persisted `useSettings` store
 * so they survive reloads; the drawer's open state lives in the ephemeral
 * `useAppStore` so it resets on launch.
 */
import {
  Drawer,
  DrawerBody,
  DrawerHeader,
  SegmentedControl,
  Stack,
  type SegmentedControlOption
} from '@/components/ui'
import { useSettings, type Accent, type Density, type Theme } from '@/hooks/useSettings'
import { useAppStore } from '@/stores/app'

const THEME_OPTIONS: SegmentedControlOption<Theme>[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const DENSITY_OPTIONS: SegmentedControlOption<Density>[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'comfortable', label: '舒适' }
]

const ACCENT_SWATCHES: { id: Accent; color: string; label: string }[] = [
  { id: 'blue', color: 'rgb(0, 111, 238)', label: '蓝' },
  { id: 'purple', color: 'rgb(120, 40, 200)', label: '紫' },
  { id: 'green', color: 'rgb(23, 140, 80)', label: '绿' },
  { id: 'teal', color: 'rgb(8, 151, 156)', label: '青' }
]

function fieldLabelStyle(): React.CSSProperties {
  return {
    fontSize: 'var(--fs-xs)',
    color: 'var(--fg3)',
    fontWeight: 'var(--fw-medium)',
    marginBottom: 6,
    display: 'block'
  }
}

export function TweaksPanel(): React.JSX.Element {
  const open = useAppStore((s) => s.tweaksOpen)
  const setOpen = useAppStore((s) => s.setTweaksOpen)

  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const accent = useSettings((s) => s.accent)
  const setAccent = useSettings((s) => s.setAccent)
  const density = useSettings((s) => s.density)
  const setDensity = useSettings((s) => s.setDensity)

  return (
    <Drawer
      isOpen={open}
      onOpenChange={setOpen}
      placement="right"
      size="sm"
      header={<DrawerHeader>Tweaks</DrawerHeader>}
    >
      <DrawerBody>
        <Stack spacing={16}>
          <div>
            <label style={fieldLabelStyle()}>主题</label>
            <SegmentedControl<Theme>
              aria-label="主题"
              value={theme}
              onChange={setTheme}
              options={THEME_OPTIONS}
              isFullWidth
            />
          </div>

          <div>
            <label style={fieldLabelStyle()}>主色调</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {ACCENT_SWATCHES.map((sw) => {
                const isSelected = accent === sw.id
                return (
                  <button
                    key={sw.id}
                    type="button"
                    aria-label={`主色调 ${sw.label}`}
                    aria-pressed={isSelected}
                    onClick={() => setAccent(sw.id)}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 8,
                      background: sw.color,
                      border: 0,
                      cursor: 'pointer',
                      padding: 0,
                      boxShadow: isSelected
                        ? `0 0 0 2px var(--bg-surface), 0 0 0 4px ${sw.color}`
                        : 'none',
                      transition: 'box-shadow var(--dur-fast)'
                    }}
                  />
                )
              })}
            </div>
          </div>

          <div>
            <label style={fieldLabelStyle()}>界面密度</label>
            <SegmentedControl<Density>
              aria-label="界面密度"
              value={density}
              onChange={setDensity}
              options={DENSITY_OPTIONS}
              isFullWidth
            />
          </div>
        </Stack>
      </DrawerBody>
    </Drawer>
  )
}

export default TweaksPanel
