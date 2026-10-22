import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'grid'
  | 'server'
  | 'chart'
  | 'plus'
  | 'refresh'
  | 'bell'
  | 'clock'
  | 'zap'
  | 'flame'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'trash'
  | 'edit'
  | 'key'
  | 'link'
  | 'eye'
  | 'eye-off'
  | 'code'
  | 'image'
  | 'sparkles'
  | 'wallet'
  | 'lock'
  | 'calendar'
  | 'info'
  | 'copy'
  | 'rotate'
  | 'arrow-up-right'
  | 'chevron-down'
  | 'chevron-right'
  | 'x'
  | 'search'
  | 'more'
  | 'download'
  | 'gauge'
  | 'layers'
  | 'arrow-right'
  | 'logo'

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  strokeWidth?: number
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  ...rest
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  )
}

const paths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </>
  ),
  server: (
    <>
      <rect x="2.5" y="3.5" width="19" height="7" rx="2" />
      <rect x="2.5" y="13.5" width="19" height="7" rx="2" />
      <path d="M6.5 7h.01M6.5 17h.01M10 7h.01M10 17h.01" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7.5 16.5v-5" />
      <path d="M12 16.5v-9" />
      <path d="M16.5 16.5v-3" />
      <path d="M21 16.5V6" opacity=".35" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20.5 11.5A8.5 8.5 0 0 0 6.2 5.8L3.5 8.3" />
      <path d="M3.5 4v4.3h4.3" />
      <path d="M3.5 12.5a8.5 8.5 0 0 0 14.3 5.7l2.7-2.5" />
      <path d="M20.5 20v-4.3h-4.3" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8-2.5 8h17S18 15 18 8.5" />
      <path d="M13.7 20.5a2 2 0 0 1-3.4 0" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3.2 1.9" />
    </>
  ),
  zap: <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />,
  flame: (
    <>
      <path d="M12 2.7c.6 3.6 2.1 5.5 4.2 7.4 1.8 1.6 2.8 3.4 2.8 5.6a7 7 0 1 1-14 0c0-2.3 1-4.2 2.9-5.9.1 1.5.7 2.6 1.8 3.3.4-4.1 1.2-7.5 2.3-10.4Z" />
      <path d="M12 20.8a3.3 3.3 0 0 0 3.3-3.3c0-1.4-.7-2.7-2-4.1-.5 1-1.2 1.7-2.1 2.3-.7-.6-1.2-1.3-1.5-2.1-.7 1.1-1 2.3-1 4a3.3 3.3 0 0 0 3.3 3.2Z" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.8-5.1" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20.3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4.2M12 16.8h.01" />
    </>
  ),
  trash: (
    <>
      <path d="M3.5 6h17M9 6V4.4A1.4 1.4 0 0 1 10.4 3h3.2A1.4 1.4 0 0 1 15 4.4V6" />
      <path d="m5.5 6 .8 12.4A2 2 0 0 0 8.3 20.4h7.4a2 2 0 0 0 2-1.9L18.5 6" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.8 12.2 9-9M16 7l3 3 3-3-3-3" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a4.5 4.5 0 0 0 6.4 0l2.3-2.3a4.5 4.5 0 0 0-6.4-6.4L11 6.1" />
      <path d="M14 10.5a4.5 4.5 0 0 0-6.4 0l-2.3 2.3a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6A9.8 9.8 0 0 1 12 5.9c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-2.4 3.1" />
      <path d="M6.5 7.3A16.7 16.7 0 0 0 2.5 12S6 18.1 12 18.1a9.6 9.6 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  code: (
    <>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.7" cy="8.7" r="1.6" />
      <path d="m21 15.5-4.6-4.6L6 21" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.2 13.8 9l5.8 1.8-5.8 1.8L12 18.4l-1.8-5.8L4.4 10.8 10.2 9Z" />
      <path d="M19 3v3M20.5 4.5h-3M5.5 18v2M6.5 19h-2" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 8V6.5A2.5 2.5 0 0 0 17.5 4H5.8A2.8 2.8 0 0 0 3 6.8v10.4A2.8 2.8 0 0 0 5.8 20h11.7a2.5 2.5 0 0 0 2.5-2.5V16" />
      <path d="M15 8h6v8h-6a4 4 0 0 1 0-8Z" />
      <path d="M16.5 12h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10.5" rx="2.5" />
      <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.4" />
      <path d="M15.5 5.5v-1a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" />
    </>
  ),
  rotate: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
    </>
  ),
  'arrow-up-right': <path d="M7 17 17 7M8 7h9v9" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="7" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v12M7 10.5l5 5 5-5" />
      <path d="M4 20.5h16" />
    </>
  ),
  gauge: (
    <>
      <path d="M4.2 18a9 9 0 1 1 15.6 0" />
      <path d="m12 13.5 4-4" />
      <circle cx="12" cy="14" r="1.4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 17 9 5 9-5" opacity=".45" />
    </>
  ),
  'arrow-right': <path d="M4 12h15M13 6l6 6-6 6" />,
  logo: (
    <path
      d="M12 2.8 13.9 9.4l6.6 1.9-6.6 1.9L12 19.8l-1.9-6.6L3.5 11.3l6.6-1.9Z"
      fill="currentColor"
      stroke="none"
    />
  ),
}
