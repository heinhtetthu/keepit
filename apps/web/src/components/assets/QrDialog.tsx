import { useEffect, useState } from 'react'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

/** QR label for an asset. The encoder is loaded only when this dialog opens. */
export default function QrDialog({ id, label, onClose }: { id: number; label: string; onClose: () => void }) {
  const url = `${window.location.origin}/assets/${id}`
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let live = true
    import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M')
      qr.addData(url)
      qr.make()
      if (live) setSvg(qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }))
    })
    return () => { live = false }
  }, [url])
  const print = () => {
    const w = window.open('', '_blank', 'width=420,height=520')
    if (!w) return
    w.document.title = label
    const wrap = w.document.createElement('div')
    wrap.style.cssText = 'font-family:sans-serif;text-align:center;padding:16px'
    wrap.innerHTML = svg
    const caption = w.document.createElement('p')
    caption.textContent = label
    wrap.appendChild(caption)
    w.document.body.appendChild(wrap)
    w.print()
  }
  return (
    <Modal size="sm" title="QR label" subtitle={label} onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={!svg} onClick={print}>Print</Button></>}>
      <div className="mx-auto w-56" aria-label={`QR code linking to ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="mt-2 break-all text-center text-xs text-gray-500">{url}</p>
    </Modal>
  )
}
