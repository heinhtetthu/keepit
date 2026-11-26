import { Children, isValidElement, ReactElement, ReactNode, useMemo } from 'react'
import Combobox, { type ComboOption } from './combobox'

type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean }

function text(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement(node)) return text((node.props as { children?: ReactNode }).children)
  return ''
}

function collect(children: ReactNode, out: ComboOption[] = []): ComboOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const el = child as ReactElement<OptionProps & { label?: string }>
    if (el.type === 'option') {
      if (el.props.disabled && el.props.value === '') return
      const label = text(el.props.children)
      out.push({ value: el.props.value !== undefined ? String(el.props.value) : label, label: label || '—' })
    } else if (el.props?.children) {
      collect(el.props.children, out)
    }
  })
  return out
}

export interface SelectProps {
  value?: string | number | null
  defaultValue?: string | number
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void
  children?: ReactNode
  className?: string
  disabled?: boolean
  placeholder?: string
  id?: string
  name?: string
  required?: boolean
  'aria-label'?: string
  title?: string
}

/**
 * Drop-in replacement for a native <select>: same `value` / `onChange(e)` /
 * `<option>` children API, rendered as a searchable dropdown with a properly
 * spaced chevron. Native selects are not used anywhere in the app.
 */
export function Select({ value, defaultValue, onChange, children, className, disabled, placeholder = 'Select…', 'aria-label': ariaLabel, title }: SelectProps) {
  const options = useMemo(() => collect(children), [children])
  const current = value ?? defaultValue ?? ''
  return (
    <div aria-label={ariaLabel} title={title} className={className?.includes('w-') ? className.split(' ').filter((c) => /^(w-|min-w-|max-w-|sm:w-|md:w-|flex-|shrink|grow)/.test(c)).join(' ') : 'w-full'}>
      <Combobox
        options={options}
        value={String(current)}
        disabled={disabled}
        placeholder={placeholder}
        className={className?.split(' ').filter((c) => /^(h-|text-)/.test(c)).join(' ')}
        onChange={(v) => onChange?.({ target: { value: v ?? '' }, currentTarget: { value: v ?? '' } })}
      />
    </div>
  )
}
