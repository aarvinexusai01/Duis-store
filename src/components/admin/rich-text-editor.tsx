"use client"

import { EditorContent, useEditor, type JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  BoldIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import type { RichTextDocument } from "@/lib/rich-text"
import { cn } from "@/lib/utils"

/**
 * Tiptap limited to the stored rich-text subset (lib/rich-text.ts): no
 * code blocks or images, headings 2–4, safe links. The server validates the
 * JSON again on save.
 */
export function RichTextEditor({
  value,
  onChange,
  label,
}: {
  value: RichTextDocument | null
  onChange: (doc: RichTextDocument | null) => void
  label: string
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        codeBlock: false,
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["https", "http", "mailto", "tel"],
          HTMLAttributes: { rel: "noopener noreferrer", target: null },
        },
      }),
    ],
    content: (value as JSONContent | null) ?? "",
    editorProps: {
      attributes: {
        "aria-label": label,
        class: "rich-text min-h-40 px-3 py-2 focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? null : (editor.getJSON() as RichTextDocument))
    },
  })

  const tool = (
    name: string,
    icon: ReactNode,
    action: () => void,
    active = false,
  ) => (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={active}
      onClick={action}
      disabled={!editor}
      className={cn(
        "rounded-sm p-1.5 hover:bg-secondary",
        active && "bg-secondary",
      )}
    >
      {icon}
    </button>
  )

  return (
    <div className="rounded-sm border border-input bg-card">
      <div
        className="flex flex-wrap gap-0.5 border-b p-1"
        role="toolbar"
        aria-label={`${label} formatting`}
      >
        {tool(
          "Bold",
          <BoldIcon className="size-4" />,
          () => editor?.chain().focus().toggleBold().run(),
          editor?.isActive("bold"),
        )}
        {tool(
          "Italic",
          <ItalicIcon className="size-4" />,
          () => editor?.chain().focus().toggleItalic().run(),
          editor?.isActive("italic"),
        )}
        {tool(
          "Underline",
          <UnderlineIcon className="size-4" />,
          () => editor?.chain().focus().toggleUnderline().run(),
          editor?.isActive("underline"),
        )}
        {tool(
          "Strikethrough",
          <StrikethroughIcon className="size-4" />,
          () => editor?.chain().focus().toggleStrike().run(),
          editor?.isActive("strike"),
        )}
        {tool(
          "Heading",
          <Heading2Icon className="size-4" />,
          () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
          editor?.isActive("heading", { level: 2 }),
        )}
        {tool(
          "Subheading",
          <Heading3Icon className="size-4" />,
          () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
          editor?.isActive("heading", { level: 3 }),
        )}
        {tool(
          "Bullet list",
          <ListIcon className="size-4" />,
          () => editor?.chain().focus().toggleBulletList().run(),
          editor?.isActive("bulletList"),
        )}
        {tool(
          "Numbered list",
          <ListOrderedIcon className="size-4" />,
          () => editor?.chain().focus().toggleOrderedList().run(),
          editor?.isActive("orderedList"),
        )}
        {tool(
          "Quote",
          <QuoteIcon className="size-4" />,
          () => editor?.chain().focus().toggleBlockquote().run(),
          editor?.isActive("blockquote"),
        )}
        {tool("Divider", <MinusIcon className="size-4" />, () =>
          editor?.chain().focus().setHorizontalRule().run(),
        )}
        {tool(
          "Link",
          <LinkIcon className="size-4" />,
          () => {
            if (!editor) return
            if (editor.isActive("link")) {
              editor.chain().focus().unsetLink().run()
              return
            }
            const href = window.prompt("Link address (https://… or /path)")
            if (href && /^(https?:\/\/|mailto:|tel:|\/(?!\/))/i.test(href)) {
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href })
                .run()
            }
          },
          editor?.isActive("link"),
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
