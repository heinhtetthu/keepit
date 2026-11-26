import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export interface AnswerTable {
  summary: string
  rows: { name: string; type: string; date: string; url: string }[]
  note: string
}

// Render a deliberately small Markdown subset as React text; never inject HTML.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith('`') && part.endsWith('`') ? <code key={i} className="rounded bg-gray-100 px-1 text-xs">{part.slice(1, -1)}</code>
        : <Fragment key={i}>{part}</Fragment>)
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
const listLine = (line: string) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)
const tableRule = (line: string) => line.includes('|') && cells(line).every(c => /^:?-{3,}:?$/.test(c))

function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (line.includes('|') && i + 1 < lines.length && tableRule(lines[i + 1])) {
      const headers = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      blocks.push(<div key={i} role="region" aria-label="Answer table" tabIndex={0} className="max-w-full overflow-x-auto rounded-md border bg-white">
        <table className="w-full text-left text-xs"><thead className="bg-gray-50"><tr>{headers.map((h, k) => <th key={k} scope="col" className="border-b px-3 py-2 font-semibold">{inline(h)}</th>)}</tr></thead>
          <tbody>{rows.map((row, n) => <tr key={n} className="border-b last:border-0">{headers.map((_, k) => <td key={k} className="px-3 py-2 align-top">{inline(row[k] || '')}</td>)}</tr>)}</tbody></table>
      </div>)
    } else if (listLine(line)) {
      const ordered = /^\s*\d+[.)]/.test(line)
      const start = ordered ? Number(line.trim().match(/^\d+/)?.[0]) : undefined
      const items: string[] = []
      while (i < lines.length) {
        if (!listLine(lines[i]) || /^\s*\d+[.)]/.test(lines[i]) !== ordered) break
        let item = lines[i++].replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !listLine(lines[i])) item += '\n' + lines[i++].trim()
        items.push(item)
        if (!lines[i]?.trim() && listLine(lines[i + 1] || '')) i++
      }
      const children = items.map((item, k) => <li key={k} className="pl-1 whitespace-pre-line">{inline(item)}</li>)
      blocks.push(ordered ? <ol key={i} start={start} className="list-decimal pl-5 space-y-2">{children}</ol> : <ul key={i} className="list-disc pl-5 space-y-2">{children}</ul>)
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(<h3 key={i} className="font-semibold text-gray-900">{inline(line.replace(/^#{1,6}\s+/, ''))}</h3>); i++
    } else {
      const paragraph = [line]; i++
      while (i < lines.length && lines[i].trim() && !listLine(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !(lines[i].includes('|') && tableRule(lines[i + 1] || ''))) paragraph.push(lines[i++])
      blocks.push(<p key={i} className="whitespace-pre-line">{inline(paragraph.join('\n'))}</p>)
    }
  }
  return <>{blocks}</>
}

export default function AssistantAnswer({ text, table }: { text: string; table?: AnswerTable }) {
  return <div className="min-w-0 space-y-3 break-words leading-relaxed" data-testid="assistant-answer">
    {table ? <>
      <p className="font-medium">{table.summary}</p>
      <div role="region" aria-label="Renewal records" tabIndex={0} className="max-w-full overflow-x-auto rounded-md border bg-white">
        <table className="w-full text-left text-xs"><caption className="sr-only">Records with matching renewal dates</caption>
          <thead className="bg-gray-50"><tr>{['Record', 'Type', 'Renewal date'].map(h => <th key={h} scope="col" className="border-b px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{table.rows.map((row, i) => <tr key={i} className="border-b last:border-0">
            <td className="min-w-[9rem] px-3 py-2 align-top">{/^\/records\/[a-z0-9_-]+\/\d+$/.test(row.url) ? <Link to={row.url} className="font-medium text-primary underline underline-offset-2">{row.name}</Link> : row.name}</td>
            <td className="min-w-[7rem] px-3 py-2 align-top">{row.type}</td><td className="whitespace-nowrap px-3 py-2 align-top">{row.date}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 whitespace-pre-line">{table.note}</p>
    </> : <MarkdownText text={text} />}
  </div>
}
