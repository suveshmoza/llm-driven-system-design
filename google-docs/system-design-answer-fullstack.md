# Google Docs - System Design Interview Answer (Full-Stack Focus)

> **Role Focus**: Full-Stack Engineer - End-to-End Integration, Shared Types, API Design, Real-Time Sync, State Synchronization

## Opening Statement

"Today I'll design Google Docs, a real-time collaborative document editing platform. As a full-stack engineer, I'll focus on the end-to-end architecture connecting the rich text editor to the OT backend, shared type definitions for type-safe collaboration, WebSocket protocol design, and optimistic updates that provide instant feedback while ensuring eventual consistency."

---

## Step 1: Requirements Clarification (3-5 minutes)

### Functional Requirements

1. **Document creation and editing** - Rich text with formatting
2. **Real-time collaboration** - Multiple users editing simultaneously
3. **Cursor and selection sharing** - See where others are typing
4. **Version history** - View and restore previous versions
5. **Comments and suggestions** - Threaded comments, track changes
6. **Sharing and permissions** - View, comment, edit access levels

### Non-Functional Requirements

- **Latency**: < 50ms local response, < 100ms sync to collaborators
- **Consistency**: Strong consistency via OT, eventual consistency for presence
- **Offline**: Continue editing without network, sync on reconnect
- **Type Safety**: Shared schemas between frontend and backend

### Full-Stack Challenges I'll Focus On

1. **Shared Type Definitions**: Zod schemas for operations, documents, and messages
2. **API Design**: REST for CRUD, WebSocket for real-time sync
3. **Optimistic Updates**: Immediate UI feedback with server reconciliation
4. **State Synchronization**: TanStack Query for server state, Zustand for UI state
5. **Error Handling**: Graceful degradation across the stack

---

## Step 2: System Architecture (5 minutes)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                  Frontend                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   TipTap Editor │  │  Zustand Store  │  │ TanStack Query  │                  │
│  │  (ProseMirror)  │  │   (UI State)    │  │ (Server State)  │                  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                    │                            │
│           └────────────────────┼────────────────────┘                            │
│                                │                                                 │
│                    ┌───────────▼───────────┐                                     │
│                    │   WebSocket Client    │ ◄──── Shared Types (Zod)           │
│                    │   + API Client        │                                     │
│                    └───────────┬───────────┘                                     │
└────────────────────────────────┼────────────────────────────────────────────────┘
                                 │
                    WebSocket + REST (JSON)
                                 │
┌────────────────────────────────┼────────────────────────────────────────────────┐
│                                │          Backend                                │
├────────────────────────────────┼────────────────────────────────────────────────┤
│                    ┌───────────▼───────────┐                                     │
│                    │   Express + WS        │ ◄──── Shared Types (Zod)           │
│                    │   Route Handlers      │                                     │
│                    └───────────┬───────────┘                                     │
│                                │                                                 │
│           ┌────────────────────┼────────────────────┐                            │
│           │                    │                    │                            │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌───────▼───────┐                    │
│  │    OT Engine    │  │   Services      │  │   Middleware  │                    │
│  │  (transforms)   │  │  (docs, users)  │  │  (auth, rbac) │                    │
│  └────────┬────────┘  └────────┬────────┘  └───────────────┘                    │
│           │                    │                                                 │
│           └────────────────────┼────────────────────┘                            │
│                                │                                                 │
│           ┌────────────────────┼────────────────────┐                            │
│           │                    │                    │                            │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌───────▼───────┐                    │
│  │   PostgreSQL    │  │      Redis      │  │   Pub/Sub     │                    │
│  │  (documents)    │  │   (sessions)    │  │  (broadcast)  │                    │
│  └─────────────────┘  └─────────────────┘  └───────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 3: Deep Dive - Shared Type Definitions (10 minutes)

### Operation Types with Zod

```typescript
// shared/schemas/operations.ts
import { z } from 'zod';

// Base operation schema
const BaseOperationSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  userId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  timestamp: z.number(),
});

// Insert operation
export const InsertOperationSchema = BaseOperationSchema.extend({
  type: z.literal('insert'),
  position: z.number().int().nonnegative(),
  text: z.string().min(1),
  attributes: z.record(z.unknown()).optional(), // Bold, italic, etc.
});

// Delete operation
export const DeleteOperationSchema = BaseOperationSchema.extend({
  type: z.literal('delete'),
  position: z.number().int().nonnegative(),
  length: z.number().int().positive(),
});

// Format operation
export const FormatOperationSchema = BaseOperationSchema.extend({
  type: z.literal('format'),
  position: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  attributes: z.record(z.unknown()),
});

// Union of all operations
export const OperationSchema = z.discriminatedUnion('type', [
  InsertOperationSchema,
  DeleteOperationSchema,
  FormatOperationSchema,
]);

export type InsertOperation = z.infer<typeof InsertOperationSchema>;
export type DeleteOperation = z.infer<typeof DeleteOperationSchema>;
export type FormatOperation = z.infer<typeof FormatOperationSchema>;
export type Operation = z.infer<typeof OperationSchema>;
```

### Document and User Schemas

```typescript
// shared/schemas/documents.ts
import { z } from 'zod';

export const ProseMirrorNodeSchema: z.ZodType<ProseMirrorNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    content: z.array(ProseMirrorNodeSchema).optional(),
    text: z.string().optional(),
    marks: z.array(z.object({
      type: z.string(),
      attrs: z.record(z.unknown()).optional(),
    })).optional(),
    attrs: z.record(z.unknown()).optional(),
  })
);

export const DocumentContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(ProseMirrorNodeSchema),
});

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(500),
  ownerId: z.string().uuid(),
  currentVersion: z.number().int().nonnegative(),
  content: DocumentContentSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const DocumentListItemSchema = DocumentSchema.pick({
  id: true,
  title: true,
  ownerId: true,
  updatedAt: true,
}).extend({
  ownerName: z.string(),
  permission: z.enum(['owner', 'edit', 'comment', 'view']),
});

export const CreateDocumentSchema = z.object({
  title: z.string().max(500).optional().default('Untitled Document'),
  content: DocumentContentSchema.optional(),
});

export const UpdateDocumentSchema = z.object({
  title: z.string().max(500).optional(),
});

export type Document = z.infer<typeof DocumentSchema>;
export type DocumentListItem = z.infer<typeof DocumentListItemSchema>;
export type CreateDocument = z.infer<typeof CreateDocumentSchema>;
export type UpdateDocument = z.infer<typeof UpdateDocumentSchema>;
```

### WebSocket Message Schemas

```typescript
// shared/schemas/messages.ts
import { z } from 'zod';
import { OperationSchema } from './operations';

// Client -> Server messages
export const JoinMessageSchema = z.object({
  type: z.literal('join'),
  documentId: z.string().uuid(),
  version: z.number().int().nonnegative(),
});

export const LeaveMessageSchema = z.object({
  type: z.literal('leave'),
  documentId: z.string().uuid(),
});

export const OperationMessageSchema = z.object({
  type: z.literal('operation'),
  documentId: z.string().uuid(),
  operationId: z.string().uuid(), // For idempotency
  version: z.number().int().nonnegative(),
  operation: OperationSchema,
});

export const CursorMessageSchema = z.object({
  type: z.literal('cursor'),
  documentId: z.string().uuid(),
  position: z.object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  JoinMessageSchema,
  LeaveMessageSchema,
  OperationMessageSchema,
  CursorMessageSchema,
]);

// Server -> Client messages
export const JoinedMessageSchema = z.object({
  type: z.literal('joined'),
  documentId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  operations: z.array(OperationSchema), // Missed ops
  users: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string(),
    cursor: z.object({ from: z.number(), to: z.number() }).nullable(),
  })),
});

export const AckMessageSchema = z.object({
  type: z.literal('ack'),
  documentId: z.string().uuid(),
  operationId: z.string().uuid(),
  version: z.number().int().nonnegative(),
});

export const BroadcastOperationSchema = z.object({
  type: z.literal('operation'),
  documentId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  operation: OperationSchema,
  userId: z.string().uuid(),
});

export const PresenceMessageSchema = z.object({
  type: z.literal('presence'),
  documentId: z.string().uuid(),
  userId: z.string().uuid(),
  action: z.enum(['join', 'leave', 'cursor']),
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string(),
    cursor: z.object({ from: z.number(), to: z.number() }).nullable(),
  }).optional(),
});

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  documentId: z.string().uuid().optional(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  JoinedMessageSchema,
  AckMessageSchema,
  BroadcastOperationSchema,
  PresenceMessageSchema,
  ErrorMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
```

---

## Step 4: Deep Dive - Validation Middleware (5 minutes)

### Express Validation Middleware

```typescript
// backend/src/middleware/validation.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Invalid query parameters',
          details: error.errors,
        });
        return;
      }
      next(error);
    }
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Invalid URL parameters',
          details: error.errors,
        });
        return;
      }
      next(error);
    }
  };
}
```

### WebSocket Message Validation

```typescript
// backend/src/ws/messageHandler.ts
import { WebSocket } from 'ws';
import { ClientMessageSchema, ServerMessage } from '@shared/schemas/messages';
import { ZodError } from 'zod';

export function handleWebSocketMessage(
  ws: WebSocket,
  data: Buffer,
  userId: string,
  handlers: MessageHandlers
): void {
  try {
    const raw = JSON.parse(data.toString());
    const message = ClientMessageSchema.parse(raw);

    switch (message.type) {
      case 'join':
        handlers.handleJoin(ws, userId, message);
        break;
      case 'leave':
        handlers.handleLeave(ws, userId, message);
        break;
      case 'operation':
        handlers.handleOperation(ws, userId, message);
        break;
      case 'cursor':
        handlers.handleCursor(ws, userId, message);
        break;
    }
  } catch (error) {
    if (error instanceof ZodError) {
      sendError(ws, 'INVALID_MESSAGE', 'Invalid message format', error.errors);
      return;
    }
    if (error instanceof SyntaxError) {
      sendError(ws, 'PARSE_ERROR', 'Invalid JSON');
      return;
    }
    logger.error({ error }, 'WebSocket message handling error');
    sendError(ws, 'INTERNAL_ERROR', 'An error occurred');
  }
}

function sendError(ws: WebSocket, code: string, message: string, details?: unknown): void {
  const error: ServerMessage = {
    type: 'error',
    code,
    message,
  };
  ws.send(JSON.stringify(error));
}
```

---

## Step 5: Deep Dive - API Routes (7 minutes)

### Document Routes

```typescript
// backend/src/routes/documents.ts
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateDocumentSchema,
  UpdateDocumentSchema,
  DocumentSchema,
  DocumentListItemSchema,
} from '@shared/schemas/documents';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { requireAuth } from '../middleware/auth';
import { requireDocumentPermission } from '../middleware/rbac';
import * as documentService from '../services/documentService';

const router = Router();

// List documents (owned + shared with me)
const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.enum(['updated', 'title', 'created']).default('updated'),
});

router.get(
  '/',
  requireAuth,
  validateQuery(ListQuerySchema),
  async (req, res) => {
    const { page, limit, sort } = req.query as z.infer<typeof ListQuerySchema>;
    const userId = req.user!.id;

    const { documents, total } = await documentService.listDocuments(userId, {
      page,
      limit,
      sort,
    });

    // Validate response shape
    const validated = z.array(DocumentListItemSchema).parse(documents);

    res.json({
      documents: validated,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }
);

// Get single document
const DocumentParamsSchema = z.object({
  id: z.string().uuid(),
});

router.get(
  '/:id',
  requireAuth,
  validateParams(DocumentParamsSchema),
  requireDocumentPermission('view'),
  async (req, res) => {
    const document = await documentService.getDocument(req.params.id);

    if (!document) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Validate and return
    const validated = DocumentSchema.parse(document);
    res.json({ document: validated });
  }
);

// Create document
router.post(
  '/',
  requireAuth,
  validateBody(CreateDocumentSchema),
  async (req, res) => {
    const userId = req.user!.id;
    const { title, content } = req.body as z.infer<typeof CreateDocumentSchema>;

    const document = await documentService.createDocument(userId, {
      title,
      content: content || { type: 'doc', content: [{ type: 'paragraph' }] },
    });

    const validated = DocumentSchema.parse(document);
    res.status(201).json({ document: validated });
  }
);

// Update document metadata
router.patch(
  '/:id',
  requireAuth,
  validateParams(DocumentParamsSchema),
  validateBody(UpdateDocumentSchema),
  requireDocumentPermission('edit'),
  async (req, res) => {
    const { title } = req.body as z.infer<typeof UpdateDocumentSchema>;

    const document = await documentService.updateDocument(req.params.id, { title });

    const validated = DocumentSchema.parse(document);
    res.json({ document: validated });
  }
);

// Delete document
router.delete(
  '/:id',
  requireAuth,
  validateParams(DocumentParamsSchema),
  requireDocumentPermission('delete'),
  async (req, res) => {
    await documentService.deleteDocument(req.params.id);
    res.status(204).send();
  }
);

export default router;
```

### Permission Routes

```typescript
// backend/src/routes/permissions.ts
import { Router } from 'express';
import { z } from 'zod';

const router = Router();

const ShareDocumentSchema = z.object({
  email: z.string().email(),
  permission: z.enum(['view', 'comment', 'edit']),
});

router.post(
  '/:id/share',
  requireAuth,
  validateParams(z.object({ id: z.string().uuid() })),
  validateBody(ShareDocumentSchema),
  requireDocumentPermission('share'),
  async (req, res) => {
    const { email, permission } = req.body as z.infer<typeof ShareDocumentSchema>;

    const result = await documentService.shareDocument(
      req.params.id,
      email,
      permission
    );

    res.json({
      shared: true,
      user: result.user || null,
      pendingInvite: !result.user,
    });
  }
);

const PermissionListSchema = z.array(z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  email: z.string().email(),
  permission: z.enum(['view', 'comment', 'edit']),
  userName: z.string().nullable(),
  createdAt: z.string().datetime(),
}));

router.get(
  '/:id/permissions',
  requireAuth,
  validateParams(z.object({ id: z.string().uuid() })),
  requireDocumentPermission('view'),
  async (req, res) => {
    const permissions = await documentService.getPermissions(req.params.id);

    const validated = PermissionListSchema.parse(permissions);
    res.json({ permissions: validated });
  }
);

export default router;
```

---

## Step 6: Deep Dive - TanStack Query Hooks (8 minutes)

### Document Queries and Mutations

```typescript
// frontend/src/hooks/useDocuments.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Document, DocumentListItem, CreateDocument } from '@shared/schemas/documents';

// Query keys factory
export const documentKeys = {
  all: ['documents'] as const,
  lists: () => [...documentKeys.all, 'list'] as const,
  list: (filters: DocumentFilters) => [...documentKeys.lists(), filters] as const,
  details: () => [...documentKeys.all, 'detail'] as const,
  detail: (id: string) => [...documentKeys.details(), id] as const,
  versions: (id: string) => [...documentKeys.detail(id), 'versions'] as const,
  comments: (id: string) => [...documentKeys.detail(id), 'comments'] as const,
};

// List documents
export function useDocuments(filters: DocumentFilters = {}) {
  return useQuery({
    queryKey: documentKeys.list(filters),
    queryFn: () => api.documents.list(filters),
    staleTime: 30 * 1000, // 30 seconds
  });
}

// Get single document
export function useDocument(id: string) {
  return useQuery({
    queryKey: documentKeys.detail(id),
    queryFn: () => api.documents.get(id),
    enabled: !!id,
  });
}

// Create document with optimistic update
export function useCreateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateDocument) => api.documents.create(data),
    onMutate: async (newDocument) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: documentKeys.lists() });

      // Snapshot previous value
      const previousDocs = queryClient.getQueryData<{ documents: DocumentListItem[] }>(
        documentKeys.list({})
      );

      // Optimistically add new document
      if (previousDocs) {
        const optimisticDoc: DocumentListItem = {
          id: `temp-${Date.now()}`,
          title: newDocument.title || 'Untitled Document',
          ownerId: '', // Will be set by server
          ownerName: 'You',
          permission: 'owner',
          updatedAt: new Date().toISOString(),
        };

        queryClient.setQueryData(documentKeys.list({}), {
          ...previousDocs,
          documents: [optimisticDoc, ...previousDocs.documents],
        });
      }

      return { previousDocs };
    },
    onError: (err, newDocument, context) => {
      // Rollback on error
      if (context?.previousDocs) {
        queryClient.setQueryData(documentKeys.list({}), context.previousDocs);
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
}

// Update document
export function useUpdateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Document> }) =>
      api.documents.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: documentKeys.detail(id) });

      const previousDoc = queryClient.getQueryData<{ document: Document }>(
        documentKeys.detail(id)
      );

      if (previousDoc) {
        queryClient.setQueryData(documentKeys.detail(id), {
          document: { ...previousDoc.document, ...data },
        });
      }

      return { previousDoc };
    },
    onError: (err, { id }, context) => {
      if (context?.previousDoc) {
        queryClient.setQueryData(documentKeys.detail(id), context.previousDoc);
      }
    },
    onSettled: (data, err, { id }) => {
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
}

// Delete document with optimistic removal
export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.documents.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: documentKeys.lists() });

      const previousDocs = queryClient.getQueryData<{ documents: DocumentListItem[] }>(
        documentKeys.list({})
      );

      if (previousDocs) {
        queryClient.setQueryData(documentKeys.list({}), {
          ...previousDocs,
          documents: previousDocs.documents.filter((doc) => doc.id !== id),
        });
      }

      return { previousDocs };
    },
    onError: (err, id, context) => {
      if (context?.previousDocs) {
        queryClient.setQueryData(documentKeys.list({}), context.previousDocs);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
}
```

### Share Document Hook

```typescript
// frontend/src/hooks/useShareDocument.ts
export function useShareDocument(documentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { email: string; permission: 'view' | 'comment' | 'edit' }) =>
      api.documents.share(documentId, data),
    onSuccess: () => {
      // Invalidate permissions list
      queryClient.invalidateQueries({
        queryKey: ['documents', documentId, 'permissions'],
      });
    },
  });
}

export function useDocumentPermissions(documentId: string) {
  return useQuery({
    queryKey: ['documents', documentId, 'permissions'],
    queryFn: () => api.documents.getPermissions(documentId),
    enabled: !!documentId,
  });
}
```

---

## Step 7: Deep Dive - WebSocket Sync Hook (8 minutes)

### WebSocket Client with Type Safety

```typescript
// frontend/src/hooks/useCollaborationSync.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ClientMessage, ServerMessage } from '@shared/schemas/messages';
import type { Operation } from '@shared/schemas/operations';
import { documentKeys } from './useDocuments';

interface UseCollaborationSyncOptions {
  documentId: string;
  initialVersion: number;
  onOperation: (operation: Operation, userId: string) => void;
  onPresence: (users: PresenceUser[]) => void;
}

export function useCollaborationSync({
  documentId,
  initialVersion,
  onOperation,
  onPresence,
}: UseCollaborationSyncOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [localVersion, setLocalVersion] = useState(initialVersion);
  const pendingOpsRef = useRef<Map<string, Operation>>(new Map());

  // Connect to WebSocket
  useEffect(() => {
    const ws = new WebSocket(`${import.meta.env.VITE_WS_URL}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');

      // Join document room
      const joinMessage: ClientMessage = {
        type: 'join',
        documentId,
        version: localVersion,
      };
      ws.send(JSON.stringify(joinMessage));
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      handleServerMessage(message);
    };

    return () => {
      // Leave document before disconnecting
      if (ws.readyState === WebSocket.OPEN) {
        const leaveMessage: ClientMessage = {
          type: 'leave',
          documentId,
        };
        ws.send(JSON.stringify(leaveMessage));
      }
      ws.close();
    };
  }, [documentId]);

  const handleServerMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'joined':
        // Apply missed operations
        for (const op of message.operations) {
          onOperation(op, op.userId);
        }
        setLocalVersion(message.version);
        onPresence(message.users);
        break;

      case 'ack':
        // Remove from pending, update version
        pendingOpsRef.current.delete(message.operationId);
        setLocalVersion(message.version);
        break;

      case 'operation':
        // Apply operation from another user
        if (!pendingOpsRef.current.has(message.operation.id)) {
          onOperation(message.operation, message.userId);
        }
        setLocalVersion(message.version);

        // Invalidate document cache
        queryClient.invalidateQueries({
          queryKey: documentKeys.detail(documentId),
        });
        break;

      case 'presence':
        // Handle presence updates
        if (message.action === 'join' || message.action === 'leave') {
          queryClient.invalidateQueries({
            queryKey: ['documents', documentId, 'presence'],
          });
        }
        break;

      case 'error':
        console.error('WebSocket error:', message.code, message.message);
        break;
    }
  }, [documentId, onOperation, onPresence, queryClient]);

  // Send operation
  const sendOperation = useCallback((operation: Operation) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Queue for offline sync
      queueOfflineOperation(operation);
      return;
    }

    const operationId = crypto.randomUUID();
    pendingOpsRef.current.set(operationId, operation);

    const message: ClientMessage = {
      type: 'operation',
      documentId,
      operationId,
      version: localVersion,
      operation,
    };

    wsRef.current.send(JSON.stringify(message));
  }, [documentId, localVersion]);

  // Send cursor position
  const sendCursor = useCallback((position: { from: number; to: number }) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const message: ClientMessage = {
      type: 'cursor',
      documentId,
      position,
    };

    wsRef.current.send(JSON.stringify(message));
  }, [documentId]);

  return {
    connectionStatus,
    sendOperation,
    sendCursor,
    localVersion,
  };
}
```

### Editor Integration with Sync

```typescript
// frontend/src/components/CollaborativeEditor.tsx
import { useEditor } from '@tiptap/react';
import { useCollaborationSync } from '../hooks/useCollaborationSync';
import { useDocument } from '../hooks/useDocuments';
import { usePresenceStore } from '../stores/presenceStore';

export function CollaborativeEditor({ documentId }: { documentId: string }) {
  const { data: documentData, isLoading } = useDocument(documentId);
  const { setUsers, updateCursor } = usePresenceStore();

  const editor = useEditor({
    // ... TipTap config
  });

  const handleRemoteOperation = useCallback((operation: Operation, userId: string) => {
    if (!editor) return;

    // Apply operation to editor
    editor.commands.command(({ tr, dispatch }) => {
      switch (operation.type) {
        case 'insert':
          tr.insertText(operation.text, operation.position);
          break;
        case 'delete':
          tr.delete(operation.position, operation.position + operation.length);
          break;
        case 'format':
          // Apply formatting marks
          break;
      }
      if (dispatch) dispatch(tr);
      return true;
    });
  }, [editor]);

  const { connectionStatus, sendOperation, sendCursor, localVersion } = useCollaborationSync({
    documentId,
    initialVersion: documentData?.document.currentVersion || 0,
    onOperation: handleRemoteOperation,
    onPresence: setUsers,
  });

  // Send local changes as operations
  useEffect(() => {
    if (!editor) return;

    const handleTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged && !transaction.getMeta('remote')) {
        const operations = transactionToOperations(transaction, localVersion);
        for (const op of operations) {
          sendOperation(op);
        }
      }
    };

    editor.on('transaction', handleTransaction);
    return () => editor.off('transaction', handleTransaction);
  }, [editor, sendOperation, localVersion]);

  // Send cursor position on selection change
  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      const { from, to } = editor.state.selection;
      sendCursor({ from, to });
    };

    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => editor.off('selectionUpdate', handleSelectionUpdate);
  }, [editor, sendCursor]);

  if (isLoading) return <EditorSkeleton />;

  return (
    <div className="relative">
      <ConnectionStatus status={connectionStatus} />
      <EditorContent editor={editor} />
    </div>
  );
}
```

---

## Step 8: Deep Dive - Comments Integration (5 minutes)

### Comments API and Hooks

```typescript
// shared/schemas/comments.ts
export const CommentSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  anchorStart: z.number().int().nonnegative(),
  anchorEnd: z.number().int().nonnegative(),
  anchorVersion: z.number().int().nonnegative(),
  content: z.string().min(1).max(10000),
  authorId: z.string().uuid(),
  authorName: z.string(),
  authorColor: z.string(),
  resolved: z.boolean(),
  createdAt: z.string().datetime(),
  replies: z.array(z.lazy(() => CommentSchema)).default([]),
});

export const CreateCommentSchema = z.object({
  anchorStart: z.number().int().nonnegative(),
  anchorEnd: z.number().int().nonnegative(),
  anchorVersion: z.number().int().nonnegative(),
  content: z.string().min(1).max(10000),
  parentId: z.string().uuid().optional(),
});

export type Comment = z.infer<typeof CommentSchema>;
export type CreateComment = z.infer<typeof CreateCommentSchema>;
```

```typescript
// frontend/src/hooks/useComments.ts
export function useComments(documentId: string) {
  const queryClient = useQueryClient();

  const commentsQuery = useQuery({
    queryKey: documentKeys.comments(documentId),
    queryFn: () => api.comments.list(documentId),
  });

  const addCommentMutation = useMutation({
    mutationFn: (data: CreateComment) => api.comments.create(documentId, data),
    onMutate: async (newComment) => {
      await queryClient.cancelQueries({ queryKey: documentKeys.comments(documentId) });

      const previousComments = queryClient.getQueryData<{ comments: Comment[] }>(
        documentKeys.comments(documentId)
      );

      // Optimistic add
      if (previousComments) {
        const optimisticComment: Comment = {
          id: `temp-${Date.now()}`,
          documentId,
          parentId: newComment.parentId || null,
          anchorStart: newComment.anchorStart,
          anchorEnd: newComment.anchorEnd,
          anchorVersion: newComment.anchorVersion,
          content: newComment.content,
          authorId: '', // Will be set by server
          authorName: 'You',
          authorColor: '#3B82F6',
          resolved: false,
          createdAt: new Date().toISOString(),
          replies: [],
        };

        queryClient.setQueryData(documentKeys.comments(documentId), {
          comments: [...previousComments.comments, optimisticComment],
        });
      }

      return { previousComments };
    },
    onError: (err, newComment, context) => {
      if (context?.previousComments) {
        queryClient.setQueryData(
          documentKeys.comments(documentId),
          context.previousComments
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.comments(documentId) });
    },
  });

  const resolveCommentMutation = useMutation({
    mutationFn: (commentId: string) => api.comments.resolve(documentId, commentId),
    onMutate: async (commentId) => {
      const previousComments = queryClient.getQueryData<{ comments: Comment[] }>(
        documentKeys.comments(documentId)
      );

      if (previousComments) {
        queryClient.setQueryData(documentKeys.comments(documentId), {
          comments: previousComments.comments.map((c) =>
            c.id === commentId ? { ...c, resolved: true } : c
          ),
        });
      }

      return { previousComments };
    },
    onError: (err, commentId, context) => {
      if (context?.previousComments) {
        queryClient.setQueryData(
          documentKeys.comments(documentId),
          context.previousComments
        );
      }
    },
  });

  return {
    comments: commentsQuery.data?.comments || [],
    isLoading: commentsQuery.isLoading,
    addComment: addCommentMutation.mutate,
    resolveComment: resolveCommentMutation.mutate,
  };
}
```

---

## Step 9: Version History Integration (4 minutes)

### Version API and Hooks

```typescript
// shared/schemas/versions.ts
export const VersionSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  versionNumber: z.number().int().nonnegative(),
  createdBy: z.string().uuid(),
  createdByName: z.string(),
  isNamed: z.boolean(),
  name: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const VersionContentSchema = z.object({
  version: VersionSchema,
  content: DocumentContentSchema,
});

export type Version = z.infer<typeof VersionSchema>;
```

```typescript
// frontend/src/hooks/useVersions.ts
export function useVersions(documentId: string) {
  return useQuery({
    queryKey: documentKeys.versions(documentId),
    queryFn: () => api.versions.list(documentId),
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useVersionContent(documentId: string, versionId: string | null) {
  return useQuery({
    queryKey: [...documentKeys.versions(documentId), versionId],
    queryFn: () => api.versions.getContent(documentId, versionId!),
    enabled: !!versionId,
  });
}

export function useRestoreVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, versionId }: { documentId: string; versionId: string }) =>
      api.versions.restore(documentId, versionId),
    onSuccess: (data, { documentId }) => {
      // Invalidate document cache to refetch restored content
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(documentId) });
      queryClient.invalidateQueries({ queryKey: documentKeys.versions(documentId) });
    },
  });
}
```

---

## Step 10: Error Handling Across the Stack (3 minutes)

### API Error Types

```typescript
// shared/schemas/errors.ts
export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.array(z.object({
    path: z.string(),
    message: z.string(),
  })).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// Frontend error handling
export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: { path: string; message: string }[]
  ) {
    super(`API Error: ${code}`);
  }
}

// API client with error handling
export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json();
    const parsed = ApiErrorSchema.safeParse(error);

    if (parsed.success) {
      throw new ApiClientError(
        response.status,
        parsed.data.code || 'UNKNOWN_ERROR',
        parsed.data.details
      );
    }

    throw new ApiClientError(response.status, 'UNKNOWN_ERROR');
  }

  return response.json();
}
```

### Global Error Boundary

```typescript
// frontend/src/components/ErrorBoundary.tsx
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ReactErrorBoundary
          onReset={reset}
          fallbackRender={({ error, resetErrorBoundary }) => (
            <div className="flex flex-col items-center justify-center min-h-screen p-8">
              <h1 className="text-2xl font-bold text-red-600 mb-4">
                Something went wrong
              </h1>
              <p className="text-gray-600 mb-4">
                {error instanceof ApiClientError
                  ? getErrorMessage(error.code)
                  : 'An unexpected error occurred'}
              </p>
              <button
                onClick={resetErrorBoundary}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Try again
              </button>
            </div>
          )}
        >
          {children}
        </ReactErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
```

---

## Step 11: Trade-offs (2 minutes)

| Decision | Alternative | Trade-off |
|----------|-------------|-----------|
| **Zod shared schemas** | TypeScript interfaces only | Runtime validation + type inference, larger bundle |
| **TanStack Query** | SWR, Redux | More features (optimistic updates), steeper learning curve |
| **WebSocket + REST** | WebSocket only | REST better for CRUD, WS for real-time |
| **Optimistic updates** | Wait for server | Better UX, more complex rollback logic |
| **Separate presence** | Combine with ops | Presence can be lossy, ops must be reliable |
| **Query key factory** | String keys | Type-safe, refactor-friendly, more boilerplate |

---

## Closing Summary

"I've designed a collaborative document editor with full-stack integration:

1. **Shared Zod schemas** for type-safe operations, documents, and messages across frontend and backend
2. **Validation middleware** that parses and validates all API requests and WebSocket messages
3. **TanStack Query hooks** with optimistic updates for instant feedback and automatic cache invalidation
4. **WebSocket sync hook** that handles operations, acknowledgments, and presence with proper error handling
5. **End-to-end error handling** with typed errors, global boundaries, and graceful degradation

The key insight is that shared type definitions eliminate an entire class of bugs (schema drift), while optimistic updates with proper rollback logic provide a responsive UX without sacrificing consistency. The separation of REST (for CRUD) and WebSocket (for real-time) allows each protocol to excel at what it does best."

---

## Potential Follow-up Questions

1. **How would you handle schema versioning?**
   - Version schemas in URL path (/v1/, /v2/)
   - Use discriminated unions for backward compatibility
   - Transform old formats at API boundary

2. **How would you test the WebSocket integration?**
   - Mock WebSocket with fake-socket library
   - Integration tests with real server
   - E2E tests with Playwright

3. **How would you handle very high latency connections?**
   - Increase pending operation buffer
   - Show sync status indicator
   - Batch operations more aggressively
