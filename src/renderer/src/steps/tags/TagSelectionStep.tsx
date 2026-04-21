/**
 * TagSelectionStep — Step 1 entry.
 *
 * Layout matches the design prototype exactly: a fixed-width left `<aside>`
 * sidebar (tree + search + filters) and a flex-1 `<div className="panel">`
 * on the right hosting the "已选标签" card.
 *
 * This fragment is rendered directly under `.content` (which is a flex row),
 * so App.tsx does NOT wrap it in `.panel-full` / `.panel`.
 */
import { TagSidebar } from './TagSidebar'
import { SelectedPanel } from './SelectedPanel'

export default function TagSelectionStep(): React.JSX.Element {
  return (
    <>
      <TagSidebar />
      <div className="panel">
        <div className="panel-inner">
          <SelectedPanel />
        </div>
      </div>
    </>
  )
}
