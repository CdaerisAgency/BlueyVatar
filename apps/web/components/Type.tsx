import type { ReactNode } from 'react'

/** Small uppercase label in deep orange. Pass `onDark` inside the developer band. */
export function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 text-[13px] font-semibold tracking-[0.12em] uppercase ${onDark ? 'text-bv-cream' : 'text-bv-orange-deep'}`}>
      {onDark && <span aria-hidden="true" className="size-2.5 flex-none rounded-full bg-bv-orange" />}
      {children}
    </span>
  )
}

/** The serif heading used for each Home section. */
export function SectionTitle({ id, children, className = '', as: Tag = 'h2' }: { id: string; children: ReactNode; className?: string; as?: 'h1' | 'h2' }) {
  return (
    <Tag id={id} className={`mt-0 mb-9 max-w-[640px] text-[clamp(30px,7vw,40px)] ${className}`}>
      {children}
    </Tag>
  )
}
