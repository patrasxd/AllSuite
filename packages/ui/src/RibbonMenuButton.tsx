import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type MouseEvent,
  type PointerEvent,
  type ComponentProps,
} from 'react'
import { Button, IconButton } from '@all/ui'
import { createPortal } from 'react-dom'
import './ribbon-menu.css'

function commandChildren(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? commandChildren(child.props.children)
      : [child],
  )
}

export interface RibbonMenuButtonProps {
  variant?: 'secondary' | 'outline'
  presentation?: 'compact' | 'large' | 'icon'
  label: string
  icon?: ReactNode
  children: ReactNode
  keepOpen?: boolean
  primaryAction?: () => void
  primaryDisabled?: boolean
  optionsLabel?: string
  onPrimaryPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
  hidden?: boolean
}

/** AllUI button composition with a portaled command disclosure and optional split action.
 * Items remain native buttons: Tab, arrows, Home/End, Enter and Space all work.
 */
export function RibbonMenuButton({
  variant = 'secondary',
  presentation = 'compact',
  label,
  icon,
  children,
  keepOpen = false,
  primaryAction,
  primaryDisabled = false,
  optionsLabel,
  onPrimaryPointerDown,
  hidden,
}: RibbonMenuButtonProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const floating = useRef<HTMLDivElement>(null)
  const initialLast = useRef(false)
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 360 })
  const triggerProps: ComponentProps<typeof IconButton> = {
    ref: trigger,
    variant,
    size: 'sm',
    icon: primaryAction ? undefined : icon,
    'aria-label': optionsLabel ?? label,
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    onKeyDown: (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        initialLast.current = event.key === 'ArrowUp'
        setOpen(true)
      }
    },
    onClick: () => {
      initialLast.current = false
      setOpen(!open)
    },
  }
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const box = trigger.current!.getBoundingClientRect()
      const menu = floating.current!.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = (viewport?.offsetLeft ?? 0) + 8
      const top = (viewport?.offsetTop ?? 0) + 8
      const width = viewport?.width ?? innerWidth
      const height = viewport?.height ?? innerHeight
      const maxHeight = Math.max(44, Math.min(360, height * 0.6, height - 16))
      const menuHeight = Math.min(menu.height, maxHeight)
      const bottom = top + height - 16
      const below = box.bottom + 4
      setPosition({
        left: Math.max(left, Math.min(box.left, left + width - menu.width - 16)),
        top: Math.max(
          top,
          Math.min(below + menuHeight <= bottom ? below : box.top - menuHeight - 4, bottom - menuHeight),
        ),
        maxHeight,
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const buttons = () => [
      ...(floating.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
      ) ?? []),
    ]
    const items = buttons()
    items[initialLast.current ? items.length - 1 : 0]?.focus()
    const dismiss = (event: Event) => {
      if (!root.current?.contains(event.target as Node) && !floating.current?.contains(event.target as Node))
        setOpen(false)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (!floating.current?.contains(event.target as Node) && !root.current?.contains(event.target as Node)) return
      const items = buttons()
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        trigger.current?.focus()
      } else if (!floating.current?.contains(event.target as Node)) {
        // The trigger already handled directional entry; do not process it twice.
        return
      } else if ((event.target as HTMLElement).matches('input, select')) {
        // Native editing and option selection retain their own keyboard behavior.
        return
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
        items[next]?.focus()
      } else if (
        event.key === 'Tab' &&
        ((event.shiftKey && index === 0) || (!event.shiftKey && index === items.length - 1))
      ) {
        // Return to the disclosure before native Tab advances in document order.
        if (event.shiftKey) event.preventDefault()
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('focusin', dismiss)
      document.removeEventListener('keydown', keyboard)
    }
  }, [open])
  return (
    <div
      hidden={hidden}
      className={`allsuite-ribbon-menu grid-command-menu allsuite-ribbon-menu--${presentation}${primaryAction ? ' allsuite-ribbon-menu--split' : ''}`}
      ref={root}
    >
      {primaryAction &&
        (presentation === 'icon' ? (
          <IconButton
            variant={variant}
            size="sm"
            icon={icon}
            aria-label={label}
            disabled={primaryDisabled}
            onClick={primaryAction}
            onPointerDown={onPrimaryPointerDown}
          />
        ) : (
          <Button
            variant={variant}
            size="sm"
            icon={icon}
            disabled={primaryDisabled}
            onClick={primaryAction}
            onPointerDown={onPrimaryPointerDown}
          >
            {label}
          </Button>
        ))}
      {presentation === 'icon' && !primaryAction ? (
        <IconButton {...triggerProps} />
      ) : (
        <Button {...triggerProps}>
          {!primaryAction && label}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="allsuite-ribbon-menu__chevron"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path d="m8 10 4 4 4-4" />
          </svg>
        </Button>
      )}
      {open &&
        createPortal(
          <div
            id={id}
            ref={floating}
            style={position}
            className="allsuite-ribbon-menu__items grid-command-menu__items"
            role="group"
            aria-label={label}
          >
            {commandChildren(children).map((child, index) => {
              if (!isValidElement(child)) return child
              const button = child as ReactElement<{ onClick?: (event: MouseEvent<HTMLButtonElement>) => void }>
              return cloneElement(button, {
                key: button.key ?? index,
                onClick: (event: MouseEvent<HTMLButtonElement>) => {
                  if (!keepOpen) {
                    setOpen(false)
                    trigger.current?.focus()
                  }
                  // Domain handlers may move focus to a cell or dialog; never steal it back.
                  button.props.onClick?.(event)
                },
              })
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
