import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { ShikiCodeBlock } from './ShikiCodeBlock';

function MarkdownParagraph(props: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  const { children, ...rest } = props;
  return (
    <p className="md-p" {...rest}>
      {children}
    </p>
  );
}

function MarkdownUl(props: React.HTMLAttributes<HTMLUListElement>): React.ReactElement {
  return <ul className="md-ul">{props.children}</ul>;
}

function MarkdownOl(props: React.HTMLAttributes<HTMLOListElement>): React.ReactElement {
  return <ol className="md-ol">{props.children}</ol>;
}

function MarkdownLi(props: React.HTMLAttributes<HTMLLIElement>): React.ReactElement {
  return <li className="md-li">{props.children}</li>;
}

function MarkdownA(props: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  return (
    <a className="md-a" href={props.href} target="_blank" rel="noreferrer">
      {props.children}
    </a>
  );
}

function MarkdownHeading({
  level,
  children
}: React.HTMLAttributes<HTMLHeadingElement> & { level: 1 | 2 | 3 | 4 | 5 | 6 }): React.ReactElement {
  const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
  return <Tag className={`md-heading md-h${level}`}>{children}</Tag>;
}

function MarkdownBlockquote(props: React.BlockquoteHTMLAttributes<HTMLQuoteElement>): React.ReactElement {
  return <blockquote className="md-blockquote">{props.children}</blockquote>;
}

function MarkdownTable(props: React.TableHTMLAttributes<HTMLTableElement>): React.ReactElement {
  return (
    <div className="md-table-wrap">
      <table className="md-table">{props.children}</table>
    </div>
  );
}

function MarkdownTh(props: React.ThHTMLAttributes<HTMLTableCellElement>): React.ReactElement {
  return <th className="md-th">{props.children}</th>;
}

function MarkdownTd(props: React.TdHTMLAttributes<HTMLTableCellElement>): React.ReactElement {
  return <td className="md-td">{props.children}</td>;
}

function MarkdownImg(props: React.ImgHTMLAttributes<HTMLImageElement>): React.ReactElement {
  return <img className="md-img" src={props.src} alt={props.alt ?? ''} loading="lazy" />;
}

export function MarkdownMessage({ content }: { content: string }): React.ReactElement {
  const components: Components = {
    h1: ({ children }) => <MarkdownHeading level={1}>{children}</MarkdownHeading>,
    h2: ({ children }) => <MarkdownHeading level={2}>{children}</MarkdownHeading>,
    h3: ({ children }) => <MarkdownHeading level={3}>{children}</MarkdownHeading>,
    h4: ({ children }) => <MarkdownHeading level={4}>{children}</MarkdownHeading>,
    h5: ({ children }) => <MarkdownHeading level={5}>{children}</MarkdownHeading>,
    h6: ({ children }) => <MarkdownHeading level={6}>{children}</MarkdownHeading>,
    p: MarkdownParagraph,
    ul: MarkdownUl,
    ol: MarkdownOl,
    li: MarkdownLi,
    a: MarkdownA,
    blockquote: MarkdownBlockquote,
    table: MarkdownTable,
    th: MarkdownTh,
    td: MarkdownTd,
    img: MarkdownImg,
    code: ({ className, children }) => {
      const text = String(children).replace(/\n$/, '');
      const match = /language-([\w-]+)/.exec(className || '');

      if (!match) {
        return <code className="md-inline-code">{children}</code>;
      }

      const lang = match[1] ?? 'text';
      return <ShikiCodeBlock code={text} language={lang} />;
    },
    pre: ({ children }) => (
      <div className="md-pre">{children}</div>
    )
  };

  return (
    <div className="markdown-message-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
