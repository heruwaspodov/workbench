/** Converts Atlassian Document Format to readable plain text (safe to render as text, no HTML). */
type Node = { type?: string; text?: string; content?: Node[]; attrs?: Record<string, any> }

const BLOCK = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'tableRow', 'panel', 'rule'])

export function adfToText(doc: unknown): string {
  if (!doc) return ''
  if (typeof doc === 'string') return doc
  const out: string[] = []
  const walk = (n: Node, depth: number) => {
    if (n.type === 'text') out.push(n.text ?? '')
    else if (n.type === 'hardBreak') out.push('\n')
    else if (n.type === 'mention') out.push(n.attrs?.text ?? '@user')
    else if (n.type === 'emoji') out.push(n.attrs?.text ?? n.attrs?.shortName ?? '')
    else if (n.type === 'inlineCard' || n.type === 'blockCard') out.push(n.attrs?.url ?? '')
    if (n.type === 'listItem') out.push(`${'  '.repeat(Math.max(0, depth - 1))}• `)
    const nextDepth = n.type === 'bulletList' || n.type === 'orderedList' ? depth + 1 : depth
    n.content?.forEach((c) => walk(c, nextDepth))
    if (n.type && BLOCK.has(n.type)) out.push('\n')
  }
  walk(doc as Node, 0)
  return out.join('').replace(/\n{3,}/g, '\n\n').trim()
}
