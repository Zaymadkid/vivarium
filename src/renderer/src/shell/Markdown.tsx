import { Fragment, type ReactNode } from "react";

/** Inline formatting: `code`, **bold**, *italic*, [text](href). Never throws on bad input. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]*`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const k = `${keyBase}-${i++}`;
    if (token.startsWith("`")) out.push(<code key={k}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) out.push(<em key={k}>{token.slice(1, -1)}</em>);
    else {
      const label = token.slice(1, token.indexOf("]"));
      const href = token.slice(token.indexOf("](") + 2, -1);
      out.push(
        <a key={k} href={href} className="md-link">
          {label}
        </a>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={`b${key++}`} className="md-code">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `h${key}`);
      if (level === 1) blocks.push(<h1 key={`b${key++}`}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={`b${key++}`}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={`b${key++}`}>{content}</h3>);
      else blocks.push(<h4 key={`b${key++}`}>{content}</h4>);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={`b${key++}`} />);
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) quote.push(lines[i++].slice(2));
      blocks.push(
        <blockquote key={`b${key++}`}>{inline(quote.join(" "), `q${key}`)}</blockquote>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`b${key++}`}>
          {items.map((it, n) => (
            <li key={n}>{inline(it, `li${key}-${n}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`b${key++}`}>
          {items.map((it, n) => (
            <li key={n}>{inline(it, `ol${key}-${n}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i]
          .slice(1, lines[i].endsWith("|") ? -1 : undefined)
          .split("|")
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...rest] = rows;
      blocks.push(
        <table key={`b${key++}`} className="md-table">
          {head && (
            <thead>
              <tr>
                {head.map((c, n) => (
                  <th key={n}>{inline(c, `th${key}-${n}`)}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rest.map((row, r) => (
              <tr key={r}>
                {row.map((c, n) => (
                  <td key={n}>{inline(c, `td${key}-${r}-${n}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("```") &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !lines[i].startsWith("> ") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].startsWith("|")
    ) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={`b${key++}`}>{inline(para.join(" "), `p${key}`)}</p>);
  }

  return <div className="md">{blocks.map((b, n) => <Fragment key={n}>{b}</Fragment>)}</div>;
}
