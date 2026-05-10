import React from 'react';

export function MarkdownMessage({ content }: { content: string }): React.ReactElement {
  return <div className="markdown-message-body message-plain">{content}</div>;
}
