# Google Docs - System Design Interview Answer (Frontend Focus)

> **Role Focus**: Frontend Engineer - Rich Text Editor, Real-time Collaboration UI, Presence Indicators, State Management, Accessibility

## Opening Statement

"Today I'll design Google Docs, a real-time collaborative document editing platform. As a frontend engineer, I'll focus on the rich text editor implementation with TipTap/ProseMirror, the real-time collaboration UI with cursor sharing and presence indicators, optimistic updates for low-latency editing, and offline support with local-first architecture."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **Rich text editing** - Bold, italic, headings, lists, links, images
2. **Real-time collaboration** - See others' edits appear live
3. **Cursor and selection sharing** - Visual indicators for collaborators
4. **Comments and suggestions** - Inline comments with threads, track changes
5. **Version history** - View and restore previous versions
6. **Document management** - Create, share, organize documents

### Non-Functional Requirements (Frontend-Specific)

- **Latency**: < 50ms for local keystroke response, < 100ms sync to collaborators
- **Offline**: Continue editing without network, sync on reconnect
- **Accessibility**: WCAG 2.1 AA compliant, full keyboard navigation
- **Performance**: Smooth editing on documents up to 100 pages

### Frontend Challenges I'll Focus On

1. **Rich Text Editor**: TipTap/ProseMirror integration with custom extensions
2. **Collaboration UI**: Cursor avatars, selection highlighting, presence list
3. **State Management**: Zustand for UI state, ProseMirror for document state
4. **Offline Support**: IndexedDB for local storage, operation queue
5. **Performance**: Virtualized rendering for large documents

---

## Step 2: Component Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DocumentPage                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                        Toolbar                                   │    │
│  │  [B][I][U][S] │ [H1][H2][H3] │ [•][1.][✓] │ [Link][Image] │ [...] │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────┐  ┌──────────────────────────┐ │
│  │           Editor                      │  │     Sidebar              │ │
│  │  ┌────────────────────────────────┐  │  │  ┌────────────────────┐  │ │
│  │  │     CollaboratorCursors        │  │  │  │  PresenceList      │  │ │
│  │  │  (overlay layer)               │  │  │  │  👤 Alice (editing) │  │ │
│  │  └────────────────────────────────┘  │  │  │  👤 Bob (viewing)   │  │ │
│  │  ┌────────────────────────────────┐  │  │  └────────────────────┘  │ │
│  │  │     TipTapEditor               │  │  │  ┌────────────────────┐  │ │
│  │  │  (ProseMirror core)            │  │  │  │  CommentsList      │  │ │
│  │  │                                │  │  │  │  💬 Comment 1      │  │ │
│  │  │  [Document content here...]    │  │  │  │  💬 Comment 2      │  │ │
│  │  │                                │  │  │  └────────────────────┘  │ │
│  │  └────────────────────────────────┘  │  │  ┌────────────────────┐  │ │
│  │  ┌────────────────────────────────┐  │  │  │  VersionHistory    │  │ │
│  │  │     InlineComments             │  │  │  │  📅 Today, 2:30 PM │  │ │
│  │  │  (margin annotations)          │  │  │  │  📅 Today, 1:15 PM │  │ │
│  │  └────────────────────────────────┘  │  │  └────────────────────┘  │ │
│  └──────────────────────────────────────┘  └──────────────────────────┘ │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      StatusBar                                   │    │
│  │  [Saving...] │ [3 collaborators] │ [Last edit: 2 min ago]       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Hierarchy

```
App
├── DocumentListPage
│   ├── DocumentGrid
│   │   └── DocumentCard (virtualized)
│   ├── NewDocumentButton
│   └── SearchBar
├── DocumentPage
│   ├── Toolbar
│   │   ├── FormatButtons
│   │   ├── HeadingDropdown
│   │   ├── ListButtons
│   │   └── InsertMenu
│   ├── EditorContainer
│   │   ├── CollaboratorCursors (overlay)
│   │   ├── TipTapEditor
│   │   └── InlineComments
│   ├── Sidebar
│   │   ├── PresenceList
│   │   ├── CommentsList
│   │   └── VersionHistory
│   └── StatusBar
├── ShareModal
├── CommentPopover
└── SuggestionBubble
```

---

## Step 3: Deep Dive - TipTap Editor Implementation (10 minutes)

### Editor Setup with Custom Extensions

```tsx
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { CommentMark } from './extensions/CommentMark';
import { SuggestionMark } from './extensions/SuggestionMark';
import { useCollaborationProvider } from '../hooks/useCollaborationProvider';
import { useDocumentStore } from '../stores/documentStore';

interface EditorProps {
  documentId: string;
  initialContent?: JSONContent;
  readOnly?: boolean;
}

export function TipTapEditor({ documentId, initialContent, readOnly = false }: EditorProps) {
  const { provider, awareness } = useCollaborationProvider(documentId);
  const { currentUser } = useDocumentStore();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false, // Disable local history - OT handles this
      }),
      Collaboration.configure({
        document: provider?.document,
      }),
      CollaborationCursor.configure({
        provider,
        user: {
          name: currentUser.name,
          color: currentUser.avatarColor,
        },
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline cursor-pointer hover:text-blue-800',
        },
      }),
      Placeholder.configure({
        placeholder: 'Start typing...',
      }),
      CommentMark,
      SuggestionMark,
    ],
    content: initialContent,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[500px] px-16 py-8',
      },
    },
  });

  // Update awareness with cursor position
  useEffect(() => {
    if (!editor || !awareness) return;

    const updateCursor = () => {
      const { from, to } = editor.state.selection;
      awareness.setLocalStateField('cursor', { from, to });
    };

    editor.on('selectionUpdate', updateCursor);
    return () => editor.off('selectionUpdate', updateCursor);
  }, [editor, awareness]);

  return (
    <div className="relative bg-white shadow-lg rounded-lg mx-auto max-w-4xl">
      <EditorContent editor={editor} />
    </div>
  );
}
```

### Custom Comment Mark Extension

```tsx
// extensions/CommentMark.ts
import { Mark, mergeAttributes } from '@tiptap/core';

export interface CommentMarkOptions {
  HTMLAttributes: Record<string, unknown>;
  onCommentClick: (commentId: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      setComment: (commentId: string) => ReturnType;
      unsetComment: () => ReturnType;
    };
  }
}

export const CommentMark = Mark.create<CommentMarkOptions>({
  name: 'comment',

  addOptions() {
    return {
      HTMLAttributes: {},
      onCommentClick: () => {},
    };
  },

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attributes => ({
          'data-comment-id': attributes.commentId,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'bg-yellow-100 border-b-2 border-yellow-400 cursor-pointer',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment: (commentId: string) => ({ commands }) => {
        return commands.setMark(this.name, { commentId });
      },
      unsetComment: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      },
    };
  },
});
```

### Custom Suggestion Mark Extension

```tsx
// extensions/SuggestionMark.ts
import { Mark, mergeAttributes } from '@tiptap/core';

export interface SuggestionMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const SuggestionMark = Mark.create<SuggestionMarkOptions>({
  name: 'suggestion',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      suggestionId: {
        default: null,
      },
      type: {
        default: 'insert', // 'insert' | 'delete'
      },
      authorId: {
        default: null,
      },
      authorName: {
        default: null,
      },
      authorColor: {
        default: '#3B82F6',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-suggestion-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const isInsert = HTMLAttributes.type === 'insert';
    const isDelete = HTMLAttributes.type === 'delete';

    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-suggestion-id': HTMLAttributes.suggestionId,
        class: cn(
          'relative',
          isInsert && 'bg-green-100 border-b-2',
          isDelete && 'bg-red-100 line-through',
        ),
        style: `border-color: ${HTMLAttributes.authorColor}`,
      }),
      0,
    ];
  },
});
```

---

## Step 4: Deep Dive - Collaborator Cursors (8 minutes)

### Cursor Overlay Component

```tsx
import { useEffect, useState } from 'react';
import { useCollaborationProvider } from '../hooks/useCollaborationProvider';

interface CursorPosition {
  from: number;
  to: number;
}

interface Collaborator {
  id: string;
  name: string;
  color: string;
  cursor: CursorPosition | null;
}

interface CollaboratorCursorsProps {
  editor: Editor | null;
  documentId: string;
}

export function CollaboratorCursors({ editor, documentId }: CollaboratorCursorsProps) {
  const { awareness } = useCollaborationProvider(documentId);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  useEffect(() => {
    if (!awareness) return;

    const updateCollaborators = () => {
      const states = awareness.getStates();
      const collabs: Collaborator[] = [];

      states.forEach((state, clientId) => {
        if (clientId === awareness.clientID) return; // Skip self

        if (state.user && state.cursor) {
          collabs.push({
            id: clientId.toString(),
            name: state.user.name,
            color: state.user.color,
            cursor: state.cursor,
          });
        }
      });

      setCollaborators(collabs);
    };

    awareness.on('change', updateCollaborators);
    updateCollaborators();

    return () => awareness.off('change', updateCollaborators);
  }, [awareness]);

  if (!editor) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {collaborators.map((collab) => (
        <CollaboratorCursor
          key={collab.id}
          editor={editor}
          collaborator={collab}
        />
      ))}
    </div>
  );
}

interface CollaboratorCursorProps {
  editor: Editor;
  collaborator: Collaborator;
}

function CollaboratorCursor({ editor, collaborator }: CollaboratorCursorProps) {
  const { cursor, name, color } = collaborator;

  if (!cursor) return null;

  // Get DOM coordinates from document position
  const cursorCoords = editor.view.coordsAtPos(cursor.from);
  const editorRect = editor.view.dom.getBoundingClientRect();

  const top = cursorCoords.top - editorRect.top;
  const left = cursorCoords.left - editorRect.left;

  // Render selection highlight if range selected
  const hasSelection = cursor.from !== cursor.to;

  return (
    <>
      {/* Selection highlight */}
      {hasSelection && (
        <SelectionHighlight
          editor={editor}
          from={cursor.from}
          to={cursor.to}
          color={color}
        />
      )}

      {/* Cursor line */}
      <div
        className="absolute w-0.5 transition-all duration-75"
        style={{
          top,
          left,
          height: cursorCoords.bottom - cursorCoords.top,
          backgroundColor: color,
        }}
      >
        {/* Name label */}
        <div
          className="absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          {name}
        </div>
      </div>
    </>
  );
}

function SelectionHighlight({ editor, from, to, color }: {
  editor: Editor;
  from: number;
  to: number;
  color: string;
}) {
  const [rects, setRects] = useState<DOMRect[]>([]);

  useEffect(() => {
    // Get all selection rectangles
    const selectionRects: DOMRect[] = [];
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);

    // For single-line selections
    if (start.top === end.top) {
      const rect = new DOMRect(
        start.left,
        start.top,
        end.left - start.left,
        start.bottom - start.top
      );
      selectionRects.push(rect);
    } else {
      // Multi-line selection - get rects for each line
      const doc = editor.view.state.doc;
      let pos = from;

      while (pos < to) {
        const lineStart = pos;
        const resolvedPos = doc.resolve(pos);
        const lineEnd = Math.min(resolvedPos.end(), to);

        const startCoords = editor.view.coordsAtPos(lineStart);
        const endCoords = editor.view.coordsAtPos(lineEnd);

        selectionRects.push(new DOMRect(
          startCoords.left,
          startCoords.top,
          endCoords.left - startCoords.left,
          startCoords.bottom - startCoords.top
        ));

        pos = lineEnd + 1;
      }
    }

    setRects(selectionRects);
  }, [editor, from, to]);

  const editorRect = editor.view.dom.getBoundingClientRect();

  return (
    <>
      {rects.map((rect, i) => (
        <div
          key={i}
          className="absolute opacity-30"
          style={{
            top: rect.top - editorRect.top,
            left: rect.left - editorRect.left,
            width: rect.width,
            height: rect.height,
            backgroundColor: color,
          }}
        />
      ))}
    </>
  );
}
```

### Presence List Sidebar

```tsx
interface PresenceListProps {
  documentId: string;
}

export function PresenceList({ documentId }: PresenceListProps) {
  const { awareness } = useCollaborationProvider(documentId);
  const [users, setUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!awareness) return;

    const updateUsers = () => {
      const states = awareness.getStates();
      const userList: PresenceUser[] = [];

      states.forEach((state) => {
        if (state.user) {
          userList.push({
            id: state.user.id,
            name: state.user.name,
            color: state.user.color,
            isActive: state.cursor !== null,
            lastActivity: state.lastActivity,
          });
        }
      });

      // Sort: active users first, then by name
      userList.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setUsers(userList);
    };

    awareness.on('change', updateUsers);
    updateUsers();

    return () => awareness.off('change', updateUsers);
  }, [awareness]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">
        Collaborators ({users.length})
      </h3>
      <ul className="space-y-1">
        {users.map((user) => (
          <li
            key={user.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-gray-100"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: user.color }}
            />
            <span className="text-sm text-gray-800">{user.name}</span>
            {user.isActive && (
              <span className="ml-auto text-xs text-green-600">editing</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Step 5: Deep Dive - Toolbar Component (5 minutes)

### Rich Text Toolbar

```tsx
import { Editor } from '@tiptap/react';
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  CheckSquareIcon,
  LinkIcon,
  ImageIcon,
  MessageSquareIcon,
  HistoryIcon,
  UndoIcon,
  RedoIcon,
} from './icons';

interface ToolbarProps {
  editor: Editor | null;
  onComment: () => void;
  onHistory: () => void;
}

export function Toolbar({ editor, onComment, onHistory }: ToolbarProps) {
  if (!editor) return null;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b bg-white px-4 py-2 shadow-sm">
      {/* Undo/Redo */}
      <ToolbarGroup>
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo (Ctrl+Z)"
        >
          <UndoIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo (Ctrl+Shift+Z)"
        >
          <RedoIcon className="h-4 w-4" />
        </ToolbarButton>
      </ToolbarGroup>

      <Divider />

      {/* Text formatting */}
      <ToolbarGroup>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold (Ctrl+B)"
        >
          <BoldIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic (Ctrl+I)"
        >
          <ItalicIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          title="Strikethrough"
        >
          <StrikethroughIcon className="h-4 w-4" />
        </ToolbarButton>
      </ToolbarGroup>

      <Divider />

      {/* Headings */}
      <ToolbarGroup>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
          title="Heading 1"
        >
          <Heading1Icon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        >
          <Heading2Icon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive('heading', { level: 3 })}
          title="Heading 3"
        >
          <Heading3Icon className="h-4 w-4" />
        </ToolbarButton>
      </ToolbarGroup>

      <Divider />

      {/* Lists */}
      <ToolbarGroup>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <ListIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrderedIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={editor.isActive('taskList')}
          title="Checklist"
        >
          <CheckSquareIcon className="h-4 w-4" />
        </ToolbarButton>
      </ToolbarGroup>

      <Divider />

      {/* Insert */}
      <ToolbarGroup>
        <ToolbarButton
          onClick={() => {
            const url = prompt('Enter URL:');
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }}
          isActive={editor.isActive('link')}
          title="Insert link (Ctrl+K)"
        >
          <LinkIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            const url = prompt('Enter image URL:');
            if (url) editor.chain().focus().setImage({ src: url }).run();
          }}
          title="Insert image"
        >
          <ImageIcon className="h-4 w-4" />
        </ToolbarButton>
      </ToolbarGroup>

      <Divider />

      {/* Collaboration */}
      <ToolbarGroup>
        <ToolbarButton
          onClick={onComment}
          disabled={editor.state.selection.empty}
          title="Add comment (Ctrl+Alt+M)"
        >
          <MessageSquareIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={onHistory} title="Version history">
          <HistoryIcon className="h-4 w-4" />
        </ToolbarButton>
      </ToolbarGroup>
    </div>
  );
}

// Reusable toolbar components
function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center">{children}</div>;
}

function ToolbarButton({
  onClick,
  disabled,
  isActive,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  isActive?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded p-2 transition-colors',
        'hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        isActive && 'bg-blue-100 text-blue-600'
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-gray-300" />;
}
```

---

## Step 6: Deep Dive - Comments System (5 minutes)

### Inline Comments Component

```tsx
interface InlineCommentsProps {
  editor: Editor | null;
  documentId: string;
}

export function InlineComments({ editor, documentId }: InlineCommentsProps) {
  const { comments, addComment, resolveComment } = useComments(documentId);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [newCommentAnchor, setNewCommentAnchor] = useState<{ from: number; to: number } | null>(null);

  // Track comment positions based on editor changes
  const commentPositions = useMemo(() => {
    if (!editor) return [];

    return comments.map((comment) => {
      // Find the mark position in the document
      const pos = findCommentMarkPosition(editor, comment.id);
      if (!pos) return null;

      const coords = editor.view.coordsAtPos(pos.from);
      const editorRect = editor.view.dom.getBoundingClientRect();

      return {
        ...comment,
        top: coords.top - editorRect.top,
      };
    }).filter(Boolean);
  }, [editor, comments]);

  const handleAddComment = useCallback(async (content: string) => {
    if (!newCommentAnchor || !editor) return;

    const commentId = crypto.randomUUID();

    // Apply comment mark to selection
    editor
      .chain()
      .focus()
      .setTextSelection(newCommentAnchor)
      .setComment(commentId)
      .run();

    // Save comment to server
    await addComment({
      id: commentId,
      content,
      anchorStart: newCommentAnchor.from,
      anchorEnd: newCommentAnchor.to,
    });

    setNewCommentAnchor(null);
  }, [newCommentAnchor, editor, addComment]);

  return (
    <div className="absolute right-0 top-0 w-64 translate-x-full space-y-2 px-4">
      {/* New comment popover */}
      {newCommentAnchor && (
        <NewCommentPopover
          onSubmit={handleAddComment}
          onCancel={() => setNewCommentAnchor(null)}
        />
      )}

      {/* Existing comments */}
      {commentPositions.map((comment) => (
        <CommentCard
          key={comment.id}
          comment={comment}
          isActive={activeComment === comment.id}
          onClick={() => setActiveComment(comment.id)}
          onResolve={() => resolveComment(comment.id)}
          style={{ top: comment.top }}
        />
      ))}
    </div>
  );
}

interface CommentCardProps {
  comment: Comment;
  isActive: boolean;
  onClick: () => void;
  onResolve: () => void;
  style: React.CSSProperties;
}

function CommentCard({ comment, isActive, onClick, onResolve, style }: CommentCardProps) {
  const [replyContent, setReplyContent] = useState('');
  const { addReply } = useComments(comment.documentId);

  const handleReply = async () => {
    if (!replyContent.trim()) return;
    await addReply(comment.id, replyContent);
    setReplyContent('');
  };

  return (
    <div
      className={cn(
        'absolute left-0 right-0 rounded-lg border bg-white p-3 shadow-sm transition-all',
        isActive ? 'border-blue-500 shadow-md' : 'border-gray-200',
        comment.resolved && 'opacity-50'
      )}
      style={style}
      onClick={onClick}
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="h-6 w-6 rounded-full"
            style={{ backgroundColor: comment.author.avatarColor }}
          />
          <span className="text-sm font-medium">{comment.author.name}</span>
        </div>
        <span className="text-xs text-gray-500">
          {formatRelativeTime(comment.createdAt)}
        </span>
      </div>

      {/* Content */}
      <p className="text-sm text-gray-800">{comment.content}</p>

      {/* Replies */}
      {comment.replies.length > 0 && (
        <div className="mt-3 space-y-2 border-l-2 border-gray-200 pl-3">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="text-sm">
              <span className="font-medium">{reply.author.name}:</span>{' '}
              {reply.content}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {isActive && !comment.resolved && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder="Reply..."
              className="flex-1 rounded border px-2 py-1 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleReply()}
            />
            <button
              onClick={handleReply}
              className="rounded bg-blue-500 px-2 py-1 text-sm text-white"
            >
              Reply
            </button>
          </div>
          <button
            onClick={onResolve}
            className="text-sm text-gray-600 hover:text-gray-800"
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## Step 7: Deep Dive - Version History (5 minutes)

### Version History Sidebar

```tsx
interface VersionHistoryProps {
  documentId: string;
  onRestore: (versionId: string) => void;
}

export function VersionHistory({ documentId, onRestore }: VersionHistoryProps) {
  const { versions, isLoading } = useVersions(documentId);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<JSONContent | null>(null);

  const handlePreview = async (versionId: string) => {
    setSelectedVersion(versionId);
    const content = await api.getVersionContent(documentId, versionId);
    setPreviewContent(content);
  };

  // Group versions by date
  const groupedVersions = useMemo(() => {
    const groups: Map<string, Version[]> = new Map();

    versions.forEach((version) => {
      const date = formatDate(version.createdAt);
      const group = groups.get(date) || [];
      group.push(version);
      groups.set(date, group);
    });

    return groups;
  }, [versions]);

  if (isLoading) {
    return <div className="animate-pulse">Loading versions...</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <h3 className="border-b p-4 text-lg font-semibold">Version History</h3>

      <div className="flex-1 overflow-auto">
        {Array.from(groupedVersions).map(([date, dateVersions]) => (
          <div key={date}>
            <div className="sticky top-0 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600">
              {date}
            </div>
            <ul className="divide-y">
              {dateVersions.map((version) => (
                <li
                  key={version.id}
                  className={cn(
                    'cursor-pointer px-4 py-3 transition-colors hover:bg-gray-50',
                    selectedVersion === version.id && 'bg-blue-50'
                  )}
                  onClick={() => handlePreview(version.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">
                        {formatTime(version.createdAt)}
                      </span>
                      {version.isNamed && (
                        <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                          {version.name}
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-gray-500">
                      {version.author.name}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {version.changesSummary}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Preview and restore actions */}
      {selectedVersion && (
        <div className="border-t p-4">
          <button
            onClick={() => onRestore(selectedVersion)}
            className="w-full rounded-lg bg-blue-600 py-2 text-white hover:bg-blue-700"
          >
            Restore this version
          </button>
        </div>
      )}

      {/* Version preview modal */}
      {previewContent && (
        <VersionPreviewModal
          content={previewContent}
          onClose={() => {
            setSelectedVersion(null);
            setPreviewContent(null);
          }}
        />
      )}
    </div>
  );
}
```

---

## Step 8: State Management (5 minutes)

### Document Store with Zustand

```typescript
// stores/documentStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DocumentState {
  // Current user
  currentUser: User | null;

  // Active document
  activeDocumentId: string | null;
  documentMeta: DocumentMeta | null;

  // UI state
  sidebarView: 'comments' | 'versions' | 'outline' | null;
  isOffline: boolean;
  saveStatus: 'saved' | 'saving' | 'error';

  // Pending operations (for offline)
  pendingOperations: PendingOperation[];

  // Actions
  setCurrentUser: (user: User | null) => void;
  setActiveDocument: (id: string, meta: DocumentMeta) => void;
  setSidebarView: (view: 'comments' | 'versions' | 'outline' | null) => void;
  setOffline: (offline: boolean) => void;
  setSaveStatus: (status: 'saved' | 'saving' | 'error') => void;
  addPendingOperation: (op: PendingOperation) => void;
  clearPendingOperations: () => void;
}

export const useDocumentStore = create<DocumentState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      activeDocumentId: null,
      documentMeta: null,
      sidebarView: null,
      isOffline: false,
      saveStatus: 'saved',
      pendingOperations: [],

      setCurrentUser: (user) => set({ currentUser: user }),

      setActiveDocument: (id, meta) => set({
        activeDocumentId: id,
        documentMeta: meta,
      }),

      setSidebarView: (view) => set({ sidebarView: view }),

      setOffline: (offline) => set({ isOffline: offline }),

      setSaveStatus: (status) => set({ saveStatus: status }),

      addPendingOperation: (op) => set((state) => ({
        pendingOperations: [...state.pendingOperations, op],
      })),

      clearPendingOperations: () => set({ pendingOperations: [] }),
    }),
    {
      name: 'document-store',
      partialize: (state) => ({
        currentUser: state.currentUser,
        pendingOperations: state.pendingOperations,
      }),
    }
  )
);
```

### Collaboration Provider Hook

```typescript
// hooks/useCollaborationProvider.ts
import { useEffect, useState, useRef } from 'react';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { useDocumentStore } from '../stores/documentStore';

export function useCollaborationProvider(documentId: string) {
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const ydocRef = useRef<Y.Doc | null>(null);

  const { currentUser, setOffline, setSaveStatus } = useDocumentStore();

  useEffect(() => {
    // Create Yjs document
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // Create WebSocket provider
    const wsProvider = new WebsocketProvider(
      import.meta.env.VITE_WS_URL || 'ws://localhost:3000',
      `doc-${documentId}`,
      ydoc,
      { connect: true }
    );

    // Set up awareness
    const awareness = wsProvider.awareness;
    if (currentUser) {
      awareness.setLocalState({
        user: {
          id: currentUser.id,
          name: currentUser.name,
          color: currentUser.avatarColor,
        },
        cursor: null,
        lastActivity: Date.now(),
      });
    }

    // Connection status handlers
    wsProvider.on('status', (event: { status: string }) => {
      if (event.status === 'connected') {
        setConnectionStatus('connected');
        setOffline(false);
        setSaveStatus('saved');
      } else if (event.status === 'disconnected') {
        setConnectionStatus('disconnected');
        setOffline(true);
      }
    });

    wsProvider.on('sync', (isSynced: boolean) => {
      if (isSynced) {
        setSaveStatus('saved');
      }
    });

    setProvider(wsProvider);
    setAwareness(awareness);

    return () => {
      wsProvider.destroy();
      ydoc.destroy();
    };
  }, [documentId, currentUser]);

  return {
    provider,
    awareness,
    connectionStatus,
    ydoc: ydocRef.current,
  };
}
```

---

## Step 9: Offline Support (3 minutes)

### Offline Queue with IndexedDB

```typescript
// lib/offlineQueue.ts
import { openDB, IDBPDatabase } from 'idb';

interface OfflineDB {
  operations: {
    key: string;
    value: PendingOperation;
  };
  documents: {
    key: string;
    value: {
      id: string;
      content: JSONContent;
      version: number;
      lastModified: number;
    };
  };
}

class OfflineQueue {
  private db: IDBPDatabase<OfflineDB> | null = null;

  async init(): Promise<void> {
    this.db = await openDB<OfflineDB>('google-docs-offline', 1, {
      upgrade(db) {
        db.createObjectStore('operations', { keyPath: 'id' });
        db.createObjectStore('documents', { keyPath: 'id' });
      },
    });
  }

  async queueOperation(operation: PendingOperation): Promise<void> {
    await this.db?.put('operations', operation);
  }

  async getQueuedOperations(documentId: string): Promise<PendingOperation[]> {
    const all = await this.db?.getAll('operations') || [];
    return all
      .filter((op) => op.documentId === documentId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async clearOperations(ids: string[]): Promise<void> {
    const tx = this.db?.transaction('operations', 'readwrite');
    for (const id of ids) {
      await tx?.store.delete(id);
    }
    await tx?.done;
  }

  async saveDocumentLocally(documentId: string, content: JSONContent, version: number): Promise<void> {
    await this.db?.put('documents', {
      id: documentId,
      content,
      version,
      lastModified: Date.now(),
    });
  }

  async getLocalDocument(documentId: string): Promise<{ content: JSONContent; version: number } | null> {
    const doc = await this.db?.get('documents', documentId);
    return doc ? { content: doc.content, version: doc.version } : null;
  }
}

export const offlineQueue = new OfflineQueue();
```

### Sync on Reconnect Hook

```typescript
// hooks/useOfflineSync.ts
export function useOfflineSync(documentId: string) {
  const { isOffline, clearPendingOperations } = useDocumentStore();
  const { provider } = useCollaborationProvider(documentId);

  // Sync pending operations when coming back online
  useEffect(() => {
    if (isOffline || !provider) return;

    const syncPendingOperations = async () => {
      const pending = await offlineQueue.getQueuedOperations(documentId);
      if (pending.length === 0) return;

      try {
        // Send all pending operations to server
        for (const op of pending) {
          await provider.send(JSON.stringify({
            type: 'operation',
            docId: documentId,
            operationId: op.id,
            operation: op.operation,
            version: op.baseVersion,
          }));
        }

        // Clear synced operations
        await offlineQueue.clearOperations(pending.map((op) => op.id));
        clearPendingOperations();
      } catch (error) {
        console.error('Failed to sync pending operations:', error);
      }
    };

    syncPendingOperations();
  }, [isOffline, provider, documentId]);

  return null;
}
```

---

## Step 10: Keyboard Accessibility (3 minutes)

### Keyboard Navigation Hook

```typescript
// hooks/useEditorKeyboard.ts
export function useEditorKeyboard(editor: Editor | null) {
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const { key, ctrlKey, metaKey, altKey, shiftKey } = event;
      const mod = ctrlKey || metaKey;

      // Comment shortcut: Ctrl+Alt+M
      if (mod && altKey && key === 'm') {
        event.preventDefault();
        if (!editor.state.selection.empty) {
          // Trigger comment creation
          window.dispatchEvent(new CustomEvent('createComment'));
        }
        return;
      }

      // Link shortcut: Ctrl+K
      if (mod && key === 'k') {
        event.preventDefault();
        const url = prompt('Enter URL:');
        if (url) {
          editor.chain().focus().setLink({ href: url }).run();
        }
        return;
      }

      // Heading shortcuts: Ctrl+Alt+1/2/3
      if (mod && altKey && ['1', '2', '3'].includes(key)) {
        event.preventDefault();
        const level = parseInt(key) as 1 | 2 | 3;
        editor.chain().focus().toggleHeading({ level }).run();
        return;
      }

      // List shortcuts
      if (mod && shiftKey && key === '7') {
        event.preventDefault();
        editor.chain().focus().toggleOrderedList().run();
        return;
      }

      if (mod && shiftKey && key === '8') {
        event.preventDefault();
        editor.chain().focus().toggleBulletList().run();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editor]);
}
```

### Focus Management

```typescript
// components/FocusTrap.tsx
export function FocusTrap({ children, active }: { children: React.ReactNode; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const focusableElements = containerRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);
    firstElement?.focus();

    return () => document.removeEventListener('keydown', handleTabKey);
  }, [active]);

  return <div ref={containerRef}>{children}</div>;
}
```

---

## Step 11: Performance Optimizations (2 minutes)

### Large Document Handling

```typescript
// hooks/useLargeDocumentOptimizations.ts
export function useLargeDocumentOptimizations(editor: Editor | null) {
  // Throttle cursor updates to reduce WebSocket traffic
  const throttledCursorUpdate = useThrottle((position: CursorPosition) => {
    awareness?.setLocalStateField('cursor', position);
  }, 50); // 20 updates/second max

  // Debounce save status updates
  const debouncedSaveStatus = useDebounce(() => {
    setSaveStatus('saved');
  }, 1000);

  // Virtualize the document view for very long documents
  useEffect(() => {
    if (!editor) return;

    const doc = editor.state.doc;
    if (doc.content.size > 100000) {
      // Enable virtual rendering for large documents
      editor.setOptions({
        editorProps: {
          ...editor.options.editorProps,
          // Only render visible paragraphs
          handleDOMEvents: {
            scroll: () => {
              requestAnimationFrame(() => {
                updateVisibleRange(editor);
              });
            },
          },
        },
      });
    }
  }, [editor]);
}
```

---

## Step 12: Trade-offs (2 minutes)

| Decision | Alternative | Trade-off |
|----------|-------------|-----------|
| **TipTap/ProseMirror** | Slate.js, Quill | Better OT support, steeper learning curve |
| **Zustand** | Redux, Jotai | Simpler API, less boilerplate, smaller bundle |
| **CSS cursor overlay** | ProseMirror decorations | More control, but manual position calculations |
| **IndexedDB offline** | Service Worker cache | Better for structured data, more complex API |
| **WebSocket (Yjs)** | Custom OT implementation | Proven library, less control over protocol |
| **Comment marks** | Decorations | Persisted with document, requires anchor tracking |

---

## Closing Summary

"I've designed a collaborative document editor frontend with:

1. **TipTap/ProseMirror integration** with custom extensions for comments and suggestions
2. **Real-time cursor sharing** using awareness protocol with smooth animations
3. **Rich toolbar** with full formatting controls and keyboard shortcuts
4. **Comments system** with inline anchors that track document changes
5. **Offline support** using IndexedDB for local storage and operation queuing
6. **Accessibility** with WCAG 2.1 AA compliance and full keyboard navigation

The key insight is that ProseMirror's transaction model naturally integrates with OT, while the awareness protocol provides low-latency presence sharing. The offline-first architecture ensures editing continues seamlessly during network interruptions."

---

## Potential Follow-up Questions

1. **How would you optimize for very large documents (100+ pages)?**
   - Virtualized rendering (only render visible paragraphs)
   - Lazy loading of document sections
   - Debounced/batched operation broadcasts

2. **How would you implement real-time spell checking?**
   - Web Worker for spell check computation
   - Decorations for underlines (not marks, for performance)
   - Dictionary loaded progressively

3. **How would you handle image uploads in the editor?**
   - Drop zone with preview
   - Upload to object storage, insert placeholder
   - Replace placeholder with final URL on complete
