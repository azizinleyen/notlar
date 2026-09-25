// ============================================================================
//  Ham notlar editoru (TipTap).
//  Spec: "Editör: TipTap (zengin metin; vurgu + buyutec isaretleri)".
//  Burada vurgu (kalin / isaretleme / madde) yapilir; buyutec isaretleri
//  AI ile uretilen notlarda bulunur (NoteEditor -> EnhancedView).
//
//  Saklama bicimi HTML'dir; AI'ye gonderilirken shared/text.ts -> rawNotesToPlain
//  ile sade metne cevrilir.
// ============================================================================

import { useEffect } from 'react'
import { Bold, Highlighter, Italic, List, ListOrdered, Quote } from 'lucide-react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import clsx from 'clsx'
import { normalizeRawNotesForEditor } from '@shared/text'

interface Props {
  /** Kaydedilmis ham not icerigi (HTML veya eski duz metin) */
  value: string
  /** Her degisiklikte cagrilir (HTML) */
  onChange: (html: string) => void
  /** Baska bir nota gecildiginde editoru tazelemek icin anahtar */
  editorKey: string
}

function ToolbarButton({
  active,
  onClick,
  title,
  children
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // secim kaybolmasin
      onClick={onClick}
      className={clsx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        active ? 'bg-pill text-ink' : 'text-muted hover:bg-pill hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

export default function RawNotesEditor({ value, onChange, editorKey }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        horizontalRule: false
      }),
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({
        placeholder: 'Aklında kalanları buraya yaz. AI bunları çekirdek alacak.'
      })
    ],
    content: normalizeRawNotesForEditor(value),
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML()
      // Bos editor '<p></p>' dondurur; bunu bos metin kabul et
      onChange(ed.isEmpty ? '' : html)
    },
    editorProps: {
      attributes: {
        class:
          'tiptap-notes min-h-[120px] w-full text-[13.5px] leading-[1.7] text-inkSoft outline-none'
      }
    }
  })

  // Not degisince icerigi yenile
  useEffect(() => {
    if (!editor) return
    const next = normalizeRawNotesForEditor(value)
    if (editor.isEmpty ? !next : editor.getHTML() !== next) {
      editor.commands.setContent(next, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey, editor])

  if (!editor) return null

  return (
    <div className="rounded-xl border border-hairline bg-canvas">
      <div className="flex items-center gap-0.5 border-b border-hairlineSoft px-2 py-1">
        <ToolbarButton
          title="Kalın (Ctrl+B)"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="İtalik (Ctrl+I)"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Vurgula"
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        >
          <Highlighter size={14} />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-hairline" />
        <ToolbarButton
          title="Madde listesi"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Numaralı liste"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Alıntı"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={14} />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} className="px-3 py-2.5" />
    </div>
  )
}