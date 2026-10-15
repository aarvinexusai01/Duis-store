import type { Route } from "next"
import Link from "next/link"
import type { ReactNode } from "react"

import type {
  RichTextBlock,
  RichTextDocument,
  RichTextInline,
} from "@/lib/rich-text"
import { cn } from "@/lib/utils"

/**
 * Renders the validated rich-text subset (lib/rich-text.ts) to elements.
 * There is no HTML string anywhere on this path, so stored content cannot
 * inject markup.
 */
export function RichText({
  document,
  className,
}: {
  document: RichTextDocument
  className?: string
}) {
  return (
    <div className={cn("rich-text", className)}>
      {document.content.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  )
}

function Block({ block }: { block: RichTextBlock }): ReactNode {
  switch (block.type) {
    case "paragraph":
      return <p>{inlines(block.content)}</p>
    case "heading": {
      const Tag = `h${block.attrs.level}` as const
      return <Tag>{inlines(block.content)}</Tag>
    }
    case "bulletList":
    case "orderedList": {
      const List = block.type === "bulletList" ? "ul" : "ol"
      return (
        <List>
          {block.content.map((item, index) => (
            <li key={index}>
              {item.content.map((child, childIndex) => (
                <Block key={childIndex} block={child} />
              ))}
            </li>
          ))}
        </List>
      )
    }
    case "blockquote":
      return (
        <blockquote>
          {block.content.map((child, index) => (
            <Block key={index} block={child} />
          ))}
        </blockquote>
      )
    case "horizontalRule":
      return <hr />
  }
}

function inlines(nodes: RichTextInline[] | undefined): ReactNode {
  return nodes?.map((node, index) => <Inline key={index} node={node} />)
}

function Inline({ node }: { node: RichTextInline }): ReactNode {
  if (node.type === "hardBreak") return <br />
  let content: ReactNode = node.text
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        content = <strong>{content}</strong>
        break
      case "italic":
        content = <em>{content}</em>
        break
      case "underline":
        content = <u>{content}</u>
        break
      case "strike":
        content = <s>{content}</s>
        break
      case "code":
        content = <code>{content}</code>
        break
      case "link":
        content = mark.attrs.href.startsWith("/") ? (
          <Link href={mark.attrs.href as Route}>{content}</Link>
        ) : (
          <a href={mark.attrs.href} rel="noopener noreferrer">
            {content}
          </a>
        )
        break
    }
  }
  return content
}
