/**
 * Unified UI entry point.
 *
 * - Re-exports every @timeui/react component available to the project.
 * - Ships three in-house patches that TimeUI does not provide
 *   (Icon / Progress / TagTree).
 *
 * Business code should import from '@/components/ui', never directly
 * from '@timeui/react', so that future TimeUI upgrades (e.g. once they
 * publish a Tree / Progress / Icon) are a single-file swap.
 */
export * from '@timeui/react'

export { Icon, iconPath } from './Icon'
export type { IconName, IconProps } from './Icon'

export { Progress } from './Progress'
export type { ProgressProps, ProgressVariant, ProgressSize } from './Progress'

export { TagTree } from './TagTree'
export type { TagTreeProps, TreeNode } from './TagTree'
