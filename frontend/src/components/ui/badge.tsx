import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-zinc-900 text-zinc-50 shadow hover:bg-zinc-900/80 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/80',
        secondary:
          'border-transparent bg-zinc-100 text-zinc-900 hover:bg-zinc-100/80 dark:bg-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-800/80',
        destructive:
          'border-transparent bg-red-500 text-zinc-50 shadow hover:bg-red-500/80 dark:bg-red-900 dark:text-zinc-50 dark:hover:bg-red-900/80',
        outline: 'text-zinc-950 dark:text-zinc-50',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

// react-doctor-disable-next-line react-doctor/only-export-components -- safe: shadcn/ui pattern co-locates component + variant generator. HMR fast refresh falls back to full reload for this file; no runtime impact. Mirrors the inline eslint-disable for react-refresh/only-export-components on the export line below; react-doctor (npm) doesn't honor eslint-disable comments and needs its own. (Earlier `oxlint-disable-next-line` was a misnamed runner — the configured runner is `react-doctor`, not `oxlint`.)
export { Badge, badgeVariants } // eslint-disable-line react-refresh/only-export-components -- safe: shadcn/ui pattern co-locates component + variant generator. HMR fast refresh falls back to full reload for this file; no runtime impact.