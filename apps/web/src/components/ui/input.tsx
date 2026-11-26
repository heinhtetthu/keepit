import { InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const fieldClass = 'flex h-10 w-full rounded-lg border border-input bg-white px-3 text-sm text-gray-900 shadow-soft transition-[border-color,box-shadow] duration-150 placeholder:text-gray-400 hover:border-gray-300 focus-visible:border-primary focus-visible:outline-none focus-visible:shadow-glow disabled:cursor-not-allowed disabled:opacity-50'

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input className={cn(fieldClass, 'py-2 file:border-0 file:bg-transparent file:text-sm', className)} ref={ref} {...props} />
))
Input.displayName = 'Input'
export { Input }
