/**
 * StepBar — top wizard navigation. Uses TimeUI `Steps` in `navigation`
 * variant so each step is a focusable button that drives the app store.
 *
 * The EnvChip lives on the right edge; we host the whole bar in a Flex
 * container (using the existing `.stepbar` class so the surrounding CSS
 * — sticky border, padding, etc. — still applies) and let Steps flex-grow
 * into the remaining space.
 */
import { Flex, Steps, type StepItem } from '@/components/ui'
import { Icon } from '@/components/ui'
import { useAppStore, type AppStep } from '@/stores/app'
import { EnvChip } from './EnvChip'

const STEP_ITEMS: StepItem[] = [
  {
    key: 'connection',
    title: '连接 Historian',
    description: 'iFix · InTouch',
    icon: <Icon name="database" size={14} />
  },
  {
    key: 'tags',
    title: '选择标签',
    description: '按组浏览或搜索',
    icon: <Icon name="tag" size={14} />
  },
  {
    key: 'timerange',
    title: '时间与采样',
    description: '分段导出设置',
    icon: <Icon name="clock" size={14} />
  },
  {
    key: 'download',
    title: '导出与下载',
    description: '队列 · 历史',
    icon: <Icon name="download" size={14} />
  }
]

export function StepBar(): React.JSX.Element {
  const step = useAppStore((s) => s.step)
  const setStep = useAppStore((s) => s.setStep)

  return (
    <div className="stepbar">
      <Flex align="center" gap={12} style={{ flex: 1, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Steps
            variant="navigation"
            items={STEP_ITEMS}
            current={step}
            onChange={(i) => setStep(i as AppStep)}
            aria-label="导出向导步骤"
          />
        </div>
        <EnvChip />
      </Flex>
    </div>
  )
}

export default StepBar
