import type { ReactNode } from 'react';
import { cx } from './util';
import './code.css';

export type CodeLang = 'py' | 'sql' | 'js';

const KEYWORDS: Record<CodeLang, Set<string>> = {
  py: new Set(
    'def return for in while if elif else import from class and or not True False None'.split(' '),
  ),
  sql: new Set('SELECT FROM WHERE ORDER BY DESC ASC AND OR JOIN ON GROUP LIMIT'.split(' ')),
  js: new Set('const let function return if else for while new true false null'.split(' ')),
};
const COMMENT: Record<CodeLang, string> = { py: '#', sql: '--', js: '//' };
const TOKEN = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+|.)/g;

/** Deliberately tiny highlighter: enough for the short demo snippets on this page. */
function tokenize(line: string, lang: CodeLang): ReactNode[] {
  const out: ReactNode[] = [];
  const cut = line.indexOf(COMMENT[lang]);
  const code = cut >= 0 ? line.slice(0, cut) : line;
  let key = 0;
  for (const m of code.matchAll(TOKEN)) {
    const [text, str, num, ident] = m;
    if (str) out.push(<span key={key++} className="tk-s">{text}</span>);
    else if (num) out.push(<span key={key++} className="tk-n">{text}</span>);
    else if (ident) {
      const next = code[(m.index ?? 0) + text.length];
      const cls = KEYWORDS[lang].has(ident) ? 'tk-k' : next === '(' ? 'tk-f' : '';
      out.push(cls ? <span key={key++} className={cls}>{text}</span> : text);
    } else out.push(text);
  }
  if (cut >= 0) out.push(<span key={key++} className="tk-c">{line.slice(cut)}</span>);
  return out;
}

export function Code({
  code,
  lang = 'py',
  active,
  error,
  className,
}: {
  code: string;
  lang?: CodeLang;
  active?: number;
  error?: number;
  className?: string;
}) {
  return (
    <pre className={cx('code', className)}>
      <code>
        {code.split('\n').map((line, i) => (
          <span key={i} className={cx('code__line', active === i && 'is-active', error === i && 'is-error')}>
            <span className="code__no" aria-hidden="true">
              {i + 1}
            </span>
            <span className="code__src">
              {tokenize(line, lang)}
              {'\n'}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}
