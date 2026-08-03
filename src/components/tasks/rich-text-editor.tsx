"use client";

import { useEffect } from "react";
import { EditorContent, useEditor, type Content } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { RichTextDoc } from "@/types/database";

/**
 * Editor rich-text da tarefa (TipTap / ProseMirror).
 *
 * O conteúdo é gravado como JSON do ProseMirror, não como HTML. Isso
 * importa por três razões:
 *   • o servidor consegue percorrer o documento para gerar o texto do
 *     PDF sem precisar parsear HTML;
 *   • não existe superfície de XSS ao reexibir — não há HTML bruto;
 *   • o formato é estável para diff e histórico de versão.
 *
 * `immediatelyRender: false` é obrigatório em SSR: sem isso o TipTap
 * monta o editor durante a renderização do servidor e o React acusa
 * divergência de hidratação.
 */

interface RichTextEditorProps {
  content: RichTextDoc;
  onChange: (doc: RichTextDoc) => void;
  editable?: boolean;
  placeholder?: string;
  className?: string;
}

export function RichTextEditor({
  content,
  onChange,
  editable = true,
  placeholder = "Descreva a tarefa, cole referências, liste o que precisa acontecer…",
  className,
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Placeholder.configure({ placeholder }),
    ],
    // `RichTextDoc` é a nossa forma persistida (mais frouxa que o
    // `JSONContent` do TipTap, de propósito: o banco guarda o documento
    // como jsonb e não deve depender da tipagem do editor).
    content: content as Content,
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[140px] w-full text-sm leading-relaxed focus:outline-none",
          // Estilos do conteúdo. Escritos à mão em vez de @tailwindcss/typography
          // porque `prose` traz uma escala tipográfica inteira que briga
          // com os tokens do design system.
          "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
          "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-[-0.01em]",
          "[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_li]:my-0.5",
          "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-signal [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
          "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
          "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-2 [&_pre]:p-3 [&_pre]:text-xs",
          "[&_a]:text-signal [&_a]:underline [&_a]:underline-offset-2",
          // Placeholder do parágrafo vazio
          "[&_.is-editor-empty:first-child::before]:pointer-events-none",
          "[&_.is-editor-empty:first-child::before]:float-left",
          "[&_.is-editor-empty:first-child::before]:h-0",
          "[&_.is-editor-empty:first-child::before]:text-muted-foreground",
          "[&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
        ),
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getJSON() as RichTextDoc);
    },
  });

  // Ao trocar de tarefa no mesmo modal, o editor precisa recarregar.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      const current = JSON.stringify(editor.getJSON());
      if (current !== JSON.stringify(content)) {
        editor.commands.setContent(content as Content, { emitUpdate: false });
      }
    }
    // Dependência intencionalmente só em `content`: incluir `editor`
    // recriaria o conteúdo a cada tecla digitada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  if (!editor) {
    return <div className="min-h-[140px] animate-pulse rounded-lg bg-muted/50" />;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

type EditorInstance = NonNullable<ReturnType<typeof useEditor>>;

function Toolbar({ editor }: { editor: EditorInstance }) {
  const actions = [
    {
      icon: Bold,
      label: "Negrito",
      run: () => editor.chain().focus().toggleBold().run(),
      active: () => editor.isActive("bold"),
    },
    {
      icon: Italic,
      label: "Itálico",
      run: () => editor.chain().focus().toggleItalic().run(),
      active: () => editor.isActive("italic"),
    },
    {
      icon: Heading2,
      label: "Título",
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: () => editor.isActive("heading", { level: 2 }),
    },
    {
      icon: List,
      label: "Lista",
      run: () => editor.chain().focus().toggleBulletList().run(),
      active: () => editor.isActive("bulletList"),
    },
    {
      icon: ListOrdered,
      label: "Lista numerada",
      run: () => editor.chain().focus().toggleOrderedList().run(),
      active: () => editor.isActive("orderedList"),
    },
    {
      icon: Quote,
      label: "Citação",
      run: () => editor.chain().focus().toggleBlockquote().run(),
      active: () => editor.isActive("blockquote"),
    },
    {
      icon: Code,
      label: "Código",
      run: () => editor.chain().focus().toggleCode().run(),
      active: () => editor.isActive("code"),
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-surface-2/60 p-1 ring-1 ring-hairline">
      {actions.map(({ icon: Icon, label, run, active }) => (
        <button
          key={label}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={active()}
          onClick={run}
          className={cn(
            "rounded-md p-1.5 transition-colors",
            active()
              ? "bg-background text-foreground ring-1 ring-hairline"
              : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}

/**
 * Extrai texto puro de um documento ProseMirror.
 * Usado no card do Kanban (prévia) e na geração do PDF, ambos no
 * servidor — por isso a função é isolada e não depende do editor.
 */
export function docToPlainText(doc: RichTextDoc | null | undefined): string {
  if (!doc?.content) return "";

  const walk = (nodes: unknown[]): string =>
    nodes
      .map((node) => {
        if (typeof node !== "object" || node === null) return "";
        const n = node as { type?: string; text?: string; content?: unknown[] };
        if (n.type === "text") return n.text ?? "";
        if (Array.isArray(n.content)) return walk(n.content);
        return "";
      })
      .join(" ");

  return walk(doc.content).replace(/\s+/g, " ").trim();
}
