import type { ReactNode } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string; level: number }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'code'; text: string };

interface Props {
  content: string;
  streaming?: boolean;
}

export function MarkdownReplyBody({ content, streaming = false }: Props) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <div style={{
      display: 'grid',
      gap: SPACE.md,
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.lg,
      color: F.inkSoft,
      lineHeight: 1.65,
    }}>
      {blocks.map((block, index) => renderBlock(block, index))}
      {streaming && (
        <span style={{
          display: 'inline-block',
          width: 7,
          height: 14,
          background: F.fenway,
          verticalAlign: 'text-bottom',
          animation: 'cursor-blink 1.06s steps(2, start) infinite',
        }} />
      )}
    </div>
  );
}

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.type === 'heading') {
    return (
      <div key={index} style={{
        fontFamily: 'var(--font-sans)',
        fontSize: block.level === 1 ? TYPE.display.sm : TYPE.body.lg,
        fontWeight: 700,
        color: F.ink,
        lineHeight: 1.35,
      }}>
        {renderInline(block.text)}
      </div>
    );
  }

  if (block.type === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag key={index} style={{
        margin: 0,
        paddingLeft: SPACE.xl,
        display: 'grid',
        gap: SPACE.xs,
      }}>
        {block.items.map((item, itemIndex) => (
          <li key={`${itemIndex}-${item.slice(0, 20)}`} style={{ paddingLeft: SPACE.xs }}>
            {renderInline(item)}
          </li>
        ))}
      </Tag>
    );
  }

  if (block.type === 'table') {
    return <ReplyTable key={index} columns={block.columns} rows={block.rows} />;
  }

  if (block.type === 'code') {
    return (
      <pre key={index} style={{
        margin: 0,
        overflowX: 'auto',
        padding: SPACE.md,
        background: F.cream50,
        border: `1px solid ${F.border}`,
        borderRadius: RADIUS.md,
        fontFamily: 'var(--font-mono)',
        fontSize: TYPE.body.sm,
        lineHeight: 1.55,
        color: F.inkSoft,
      }}>{block.text}</pre>
    );
  }

  return (
    <p key={index} style={{ margin: 0 }}>
      {renderInline(block.text)}
    </p>
  );
}

function ReplyTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div style={{
      maxWidth: '100%',
      overflowX: 'auto',
      border: `1px solid ${F.border}`,
      borderRadius: RADIUS.md,
      background: F.surface,
    }}>
      <table style={{
        width: '100%',
        minWidth: 'max-content',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        lineHeight: 1.45,
      }}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={`${column}-${index}`} style={{
                padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
                background: F.cream50,
                borderBottom: `1px solid ${F.border}`,
                color: F.fgMuted,
                fontFamily: 'var(--font-mono)',
                fontSize: TYPE.meta.sm,
                fontWeight: 700,
                letterSpacing: TRACKING.micro,
                textAlign: isNumericColumn(rows, index) ? 'right' : 'left',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                {renderInline(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column, columnIndex) => (
                <td key={`${rowIndex}-${column}`} style={{
                  padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
                  borderBottom: rowIndex === rows.length - 1 ? 'none' : `1px solid ${F.border}`,
                  color: F.inkSoft,
                  fontVariantNumeric: 'tabular-nums',
                  textAlign: isNumericColumn(rows, columnIndex) ? 'right' : 'left',
                  whiteSpace: 'nowrap',
                }}>
                  {renderInline(row[columnIndex] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    if (isMarkdownTableAt(lines, i)) {
      const columns = splitTableRow(lines[i] ?? '');
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim()) {
        rows.push(padRow(splitTableRow(lines[i] ?? ''), columns.length));
        i += 1;
      }
      blocks.push({ type: 'table', columns, rows });
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const match = (lines[i] ?? '').match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
        if (!match || /\d+\./.test(match[2]) !== ordered) break;
        items.push(match[3].trim());
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (!current.trim()) break;
      if (current.trim().startsWith('```')) break;
      if (current.match(/^(#{1,3})\s+(.+)$/)) break;
      if (current.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/)) break;
      if (isMarkdownTableAt(lines, i)) break;
      paragraphLines.push(current.trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks.length ? blocks : [{ type: 'paragraph', text: markdown }];
}

function isMarkdownTableAt(lines: string[], index: number): boolean {
  const header = lines[index] ?? '';
  const separator = lines[index + 1] ?? '';
  if (!header.includes('|') || !separator.includes('|')) return false;
  const separatorCells = splitTableRow(separator);
  return separatorCells.length > 0 && separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function padRow(row: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => row[index] ?? '');
}

function isNumericColumn(rows: string[][], index: number): boolean {
  const values = rows.map((row) => row[index]).filter((value): value is string => Boolean(value));
  if (values.length === 0) return false;
  return values.every((value) => /^[-+]?[$]?\d[\d,.%()/-]*$/.test(value.replace(/\*\*/g, '').trim()));
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(renderInlineToken(match[0], nodes.length));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderInlineToken(token: string, key: number): ReactNode {
  if (token.startsWith('**') && token.endsWith('**')) {
    return (
      <strong key={key} style={{ fontWeight: 700, color: F.ink }}>
        {token.slice(2, -2)}
      </strong>
    );
  }
  if (token.startsWith('`') && token.endsWith('`')) {
    return (
      <code key={key} style={{
        fontFamily: 'var(--font-mono)',
        fontSize: TYPE.body.sm,
        background: F.cream50,
        border: `1px solid ${F.border}`,
        borderRadius: RADIUS.sm,
        padding: '1px 3px',
      }}>
        {token.slice(1, -1)}
      </code>
    );
  }
  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    const href = link[2];
    const isSafe = /^https?:\/\//i.test(href);
    return isSafe ? (
      <a key={key} href={href} target="_blank" rel="noreferrer" style={{ color: F.fenway, fontWeight: 600 }}>
        {link[1]}
      </a>
    ) : link[1];
  }
  return token;
}
