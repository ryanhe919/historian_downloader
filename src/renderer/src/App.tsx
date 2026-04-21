/**
 * Application shell — titlebar, step wizard, scrollable step body, footer
 * and the Tweaks drawer.
 *
 * Step 1 (Tags) fills the whole content area with its own 3-column layout,
 * so it uses `.panel-full` (no outer scroll). The other steps render inside
 * `.panel` which is a single vertical scroller.
 */
import { useSettingsSideEffects } from '@/hooks/useSettings'
import { useAppStore } from '@/stores/app'
import { TitleBar } from '@/app/TitleBar'
import { StepBar } from '@/app/StepBar'
import { FooterBar } from '@/app/FooterBar'
import { TweaksPanel } from '@/app/TweaksPanel'
import ConnectionStep from '@/steps/connection/ConnectionStep'
import TagSelectionStep from '@/steps/tags/TagSelectionStep'
import TimeRangeStep from '@/steps/timerange/TimeRangeStep'
import DownloadStep from '@/steps/download/DownloadStep'

export default function App(): React.JSX.Element {
  useSettingsSideEffects()
  const step = useAppStore((s) => s.step)

  return (
    <div className="app-window">
      <TitleBar />
      <StepBar />
      <div className="content">
        {step === 0 && (
          <div className="panel">
            <ConnectionStep />
          </div>
        )}
        {step === 1 && <TagSelectionStep />}
        {step === 2 && (
          <div className="panel">
            <TimeRangeStep />
          </div>
        )}
        {step === 3 && (
          <div className="panel">
            <DownloadStep />
          </div>
        )}
      </div>
      <FooterBar />
      <TweaksPanel />
    </div>
  )
}
