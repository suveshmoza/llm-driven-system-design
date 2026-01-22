# Dropbox - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design the frontend architecture for a cloud file storage application that allows users to:
- Browse files and folders with responsive file explorer interface
- Upload large files with progress tracking and resume capability
- Download files with range request support
- Manage file sharing through intuitive UI
- Sync changes across browser tabs and devices

## Requirements Clarification

### Functional Requirements
1. **File Browser**: Navigate folder hierarchy, preview files, bulk operations
2. **Upload Experience**: Drag-and-drop, progress bars, pause/resume, multiple files
3. **Download Experience**: Direct download, batch download as zip
4. **Sharing UI**: Create share links, manage permissions, copy URLs
5. **Version History**: View and restore previous versions

### Non-Functional Requirements
1. **Responsive**: Desktop, tablet, and mobile layouts
2. **Performance**: Folder loading < 200ms, smooth scrolling with 1000s of files
3. **Accessibility**: Keyboard navigation, screen reader support
4. **Offline Resilience**: Show cached data, queue uploads for when online

### UI/UX Requirements
- Familiar file explorer paradigm
- Visual feedback for all operations
- Upload queue with individual file progress
- Conflict indication during sync
- Breadcrumb navigation

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          React Application                               │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                        TanStack Router                               ││
│  │    /                  → File Browser (root folder)                  ││
│  │    /folder/:id        → File Browser (specific folder)              ││
│  │    /shared            → Shared with me                               ││
│  │    /trash             → Deleted files                                ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  ┌──────────────────────┐  ┌────────────────────────────────────────┐   │
│  │    Sidebar           │  │          Main Content Area              │   │
│  │  ┌────────────────┐  │  │  ┌──────────────────────────────────┐  │   │
│  │  │ Navigation     │  │  │  │        Toolbar                   │  │   │
│  │  │ - My Files     │  │  │  │  [Upload] [New Folder] [⋮]       │  │   │
│  │  │ - Shared       │  │  │  └──────────────────────────────────┘  │   │
│  │  │ - Trash        │  │  │  ┌──────────────────────────────────┐  │   │
│  │  └────────────────┘  │  │  │        Breadcrumb                │  │   │
│  │  ┌────────────────┐  │  │  │  Home > Projects > Design        │  │   │
│  │  │ Storage Quota  │  │  │  └──────────────────────────────────┘  │   │
│  │  │ ▓▓▓▓▓░░ 5/10GB │  │  │  ┌──────────────────────────────────┐  │   │
│  │  └────────────────┘  │  │  │        File Grid / List          │  │   │
│  └──────────────────────┘  │  │    [📁 folder1] [📄 file.pdf]    │  │   │
│                             │  └──────────────────────────────────┘  │   │
│  ┌──────────────────────────────────────────────────────────────────┐│   │
│  │                      Upload Queue Panel                           ││   │
│  │    📄 report.pdf   ▓▓▓▓▓▓▓░░░ 70%   [⏸] [✕]                      ││   │
│  │    📄 image.png    ▓▓▓▓▓▓▓▓▓▓ Complete ✓                         ││   │
│  └──────────────────────────────────────────────────────────────────┘│   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Zustand Store                                    ││
│  │  currentFolder | files[] | selectedIds | uploadQueue | viewMode     ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

## Deep Dive: State Management with Zustand

### Store Design

```typescript
// stores/fileStore.ts
import { create } from 'zustand';

interface FileState {
  // Navigation
  currentFolderId: string | null;
  breadcrumb: FolderInfo[];

  // Files and folders
  items: FileItem[];
  selectedIds: Set<string>;
  isLoading: boolean;

  // View options
  viewMode: 'grid' | 'list';
  sortBy: 'name' | 'date' | 'size';
  sortOrder: 'asc' | 'desc';

  // Upload queue
  uploads: UploadTask[];

  // Actions
  navigateToFolder: (folderId: string | null) => void;
  selectItem: (id: string, multi?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setSorting: (by: string, order: string) => void;

  // Upload actions
  addUpload: (file: File, folderId: string) => void;
  pauseUpload: (uploadId: string) => void;
  resumeUpload: (uploadId: string) => void;
  cancelUpload: (uploadId: string) => void;
  updateUploadProgress: (uploadId: string, progress: number) => void;

  // Data fetching
  fetchFolder: (folderId: string | null) => Promise<void>;
  refreshCurrentFolder: () => Promise<void>;
}

interface UploadTask {
  id: string;
  file: File;
  folderId: string;
  status: 'pending' | 'uploading' | 'paused' | 'completed' | 'error';
  progress: number;
  uploadedChunks: number[];
  totalChunks: number;
  error?: string;
}

export const useFileStore = create<FileState>((set, get) => ({
  currentFolderId: null,
  breadcrumb: [],
  items: [],
  selectedIds: new Set(),
  isLoading: false,
  viewMode: 'grid',
  sortBy: 'name',
  sortOrder: 'asc',
  uploads: [],

  navigateToFolder: async (folderId) => {
    set({ isLoading: true, selectedIds: new Set() });
    await get().fetchFolder(folderId);
    set({ currentFolderId: folderId, isLoading: false });
  },

  selectItem: (id, multi = false) => {
    set(state => {
      const newSelected = new Set(multi ? state.selectedIds : []);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return { selectedIds: newSelected };
    });
  },

  fetchFolder: async (folderId) => {
    const response = await api.getFolderContents(folderId);
    set({
      items: response.items,
      breadcrumb: response.breadcrumb,
    });
  },

  addUpload: (file, folderId) => {
    const uploadTask: UploadTask = {
      id: crypto.randomUUID(),
      file,
      folderId,
      status: 'pending',
      progress: 0,
      uploadedChunks: [],
      totalChunks: Math.ceil(file.size / (4 * 1024 * 1024)), // 4MB chunks
    };

    set(state => ({
      uploads: [...state.uploads, uploadTask],
    }));

    // Start upload
    startChunkedUpload(uploadTask);
  },

  updateUploadProgress: (uploadId, progress) => {
    set(state => ({
      uploads: state.uploads.map(u =>
        u.id === uploadId ? { ...u, progress } : u
      ),
    }));
  },
}));
```

### Why Zustand Over Redux?

| Factor | Zustand | Redux |
|--------|---------|-------|
| Boilerplate | Minimal | Significant |
| Bundle size | ~1KB | ~7KB + middleware |
| DevTools | Optional plugin | Built-in |
| Async actions | Native | Requires thunk/saga |
| Selective updates | Built-in | Manual with selectors |

**Decision**: Zustand's minimal API is ideal for file management state.

## Deep Dive: Chunked File Upload

### Upload Manager

```typescript
// services/uploadManager.ts
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

async function startChunkedUpload(task: UploadTask) {
  const { file, folderId, id } = task;

  // Compute chunk hashes for deduplication check
  const chunkHashes = await computeChunkHashes(file);

  // Initialize upload session
  const session = await api.initiateUpload({
    filename: file.name,
    size: file.size,
    folderId,
    chunkHashes,
  });

  // Update store with session info
  useFileStore.setState(state => ({
    uploads: state.uploads.map(u =>
      u.id === id
        ? { ...u, status: 'uploading', totalChunks: session.totalChunks }
        : u
    ),
  }));

  // Upload only needed chunks (deduplication)
  for (const chunkIndex of session.chunksNeeded) {
    const task = useFileStore.getState().uploads.find(u => u.id === id);
    if (task?.status === 'paused') break;

    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    await uploadChunk(session.uploadId, chunkIndex, chunk, chunkHashes[chunkIndex]);

    // Update progress
    const progress = ((chunkIndex + 1) / session.totalChunks) * 100;
    useFileStore.getState().updateUploadProgress(id, progress);
  }

  // Complete upload
  await api.completeUpload(session.uploadId);

  useFileStore.setState(state => ({
    uploads: state.uploads.map(u =>
      u.id === id ? { ...u, status: 'completed', progress: 100 } : u
    ),
  }));

  // Refresh folder to show new file
  useFileStore.getState().refreshCurrentFolder();
}

async function computeChunkHashes(file: File): Promise<string[]> {
  const hashes: string[] = [];
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const buffer = await chunk.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    hashes.push(hashArray.map(b => b.toString(16).padStart(2, '0')).join(''));
  }

  return hashes;
}
```

### Upload Progress UI

```tsx
// components/upload/UploadQueue.tsx
function UploadQueue() {
  const uploads = useFileStore(state => state.uploads);
  const pauseUpload = useFileStore(state => state.pauseUpload);
  const resumeUpload = useFileStore(state => state.resumeUpload);
  const cancelUpload = useFileStore(state => state.cancelUpload);

  const activeUploads = uploads.filter(u =>
    ['pending', 'uploading', 'paused'].includes(u.status)
  );

  if (activeUploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-white rounded-lg shadow-xl border">
      <div className="p-3 border-b flex justify-between items-center">
        <h3 className="font-medium">
          Uploading {activeUploads.length} file(s)
        </h3>
        <button className="text-gray-500 hover:text-gray-700">
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {activeUploads.map(upload => (
          <UploadItem
            key={upload.id}
            upload={upload}
            onPause={() => pauseUpload(upload.id)}
            onResume={() => resumeUpload(upload.id)}
            onCancel={() => cancelUpload(upload.id)}
          />
        ))}
      </div>
    </div>
  );
}

function UploadItem({ upload, onPause, onResume, onCancel }: UploadItemProps) {
  const statusIcon = {
    pending: <Clock className="w-4 h-4 text-gray-400" />,
    uploading: <Loader className="w-4 h-4 text-blue-500 animate-spin" />,
    paused: <Pause className="w-4 h-4 text-yellow-500" />,
    completed: <Check className="w-4 h-4 text-green-500" />,
    error: <AlertCircle className="w-4 h-4 text-red-500" />,
  };

  return (
    <div className="p-3 border-b last:border-b-0">
      <div className="flex items-center gap-3">
        <FileIcon filename={upload.file.name} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{upload.file.name}</p>
          <p className="text-xs text-gray-500">
            {formatBytes(upload.file.size)} - {Math.round(upload.progress)}%
          </p>
        </div>
        {statusIcon[upload.status]}
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full transition-all duration-300',
            upload.status === 'error' ? 'bg-red-500' : 'bg-blue-500'
          )}
          style={{ width: `${upload.progress}%` }}
        />
      </div>

      {/* Controls */}
      <div className="mt-2 flex gap-2">
        {upload.status === 'uploading' && (
          <button onClick={onPause} className="text-xs text-gray-600 hover:text-gray-800">
            Pause
          </button>
        )}
        {upload.status === 'paused' && (
          <button onClick={onResume} className="text-xs text-blue-600 hover:text-blue-800">
            Resume
          </button>
        )}
        <button onClick={onCancel} className="text-xs text-red-600 hover:text-red-800">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

## Deep Dive: File Browser Views

### Grid View

```tsx
// components/browser/GridView.tsx
function GridView() {
  const items = useFileStore(state => state.items);
  const selectedIds = useFileStore(state => state.selectedIds);
  const selectItem = useFileStore(state => state.selectItem);
  const navigateToFolder = useFileStore(state => state.navigateToFolder);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4 p-4">
      {items.map(item => (
        <FileCard
          key={item.id}
          item={item}
          isSelected={selectedIds.has(item.id)}
          onSelect={(multi) => selectItem(item.id, multi)}
          onOpen={() => {
            if (item.type === 'folder') {
              navigateToFolder(item.id);
            } else {
              openPreview(item);
            }
          }}
        />
      ))}
    </div>
  );
}

function FileCard({ item, isSelected, onSelect, onOpen }: FileCardProps) {
  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      onSelect(true);
    } else {
      onSelect(false);
    }
  };

  const handleDoubleClick = () => {
    onOpen();
  };

  return (
    <div
      className={cn(
        'group relative p-3 rounded-lg cursor-pointer transition-colors',
        'hover:bg-gray-100',
        isSelected && 'bg-blue-100 hover:bg-blue-100 ring-2 ring-blue-500'
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Thumbnail or icon */}
      <div className="aspect-square mb-2 flex items-center justify-center bg-gray-50 rounded-lg">
        {item.type === 'folder' ? (
          <Folder className="w-16 h-16 text-blue-500" />
        ) : item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt={item.name}
            className="w-full h-full object-cover rounded-lg"
          />
        ) : (
          <FileIcon filename={item.name} className="w-16 h-16" />
        )}
      </div>

      {/* Name */}
      <p className="text-sm text-center truncate" title={item.name}>
        {item.name}
      </p>

      {/* Selection checkbox */}
      <div
        className={cn(
          'absolute top-2 left-2 w-5 h-5 rounded border-2',
          'transition-opacity',
          isSelected
            ? 'opacity-100 bg-blue-500 border-blue-500'
            : 'opacity-0 group-hover:opacity-100 border-gray-400 bg-white'
        )}
      >
        {isSelected && <Check className="w-full h-full text-white" />}
      </div>

      {/* Context menu trigger */}
      <button
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-200"
        onClick={(e) => {
          e.stopPropagation();
          openContextMenu(item, e);
        }}
      >
        <MoreVertical className="w-4 h-4" />
      </button>
    </div>
  );
}
```

### List View with Virtualization

```tsx
// components/browser/ListView.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function ListView() {
  const items = useFileStore(state => state.items);
  const selectedIds = useFileStore(state => state.selectedIds);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // Row height
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b grid grid-cols-12 gap-4 px-4 py-2 text-sm font-medium text-gray-600">
        <div className="col-span-6">Name</div>
        <div className="col-span-2">Modified</div>
        <div className="col-span-2">Size</div>
        <div className="col-span-2">Actions</div>
      </div>

      {/* Virtualized rows */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map(virtualRow => {
          const item = items[virtualRow.index];
          return (
            <FileRow
              key={item.id}
              item={item}
              isSelected={selectedIds.has(item.id)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function FileRow({ item, isSelected, style }: FileRowProps) {
  return (
    <div
      style={style}
      className={cn(
        'grid grid-cols-12 gap-4 px-4 items-center border-b hover:bg-gray-50',
        isSelected && 'bg-blue-50'
      )}
    >
      <div className="col-span-6 flex items-center gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
          className="rounded"
        />
        <FileIcon filename={item.name} className="w-5 h-5" />
        <span className="truncate">{item.name}</span>
      </div>
      <div className="col-span-2 text-sm text-gray-600">
        {formatDate(item.updatedAt)}
      </div>
      <div className="col-span-2 text-sm text-gray-600">
        {item.type === 'folder' ? '--' : formatBytes(item.size)}
      </div>
      <div className="col-span-2">
        <button className="p-1 hover:bg-gray-200 rounded">
          <Share2 className="w-4 h-4" />
        </button>
        <button className="p-1 hover:bg-gray-200 rounded">
          <Download className="w-4 h-4" />
        </button>
        <button className="p-1 hover:bg-gray-200 rounded">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

## Deep Dive: Drag and Drop Upload

### Drop Zone Component

```tsx
// components/upload/DropZone.tsx
function DropZone({ children }: { children: React.ReactNode }) {
  const [isDragging, setIsDragging] = useState(false);
  const currentFolderId = useFileStore(state => state.currentFolderId);
  const addUpload = useFileStore(state => state.addUpload);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);

    // Handle folder drops (if supported)
    if (e.dataTransfer.items) {
      const items = Array.from(e.dataTransfer.items);
      for (const item of items) {
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry?.isDirectory) {
            await processDirectory(entry as FileSystemDirectoryEntry);
            continue;
          }
        }
      }
    }

    // Process individual files
    for (const file of files) {
      addUpload(file, currentFolderId || 'root');
    }
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative h-full"
    >
      {children}

      {/* Drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg text-center">
            <Upload className="w-12 h-12 text-blue-500 mx-auto mb-2" />
            <p className="text-lg font-medium">Drop files to upload</p>
            <p className="text-sm text-gray-500">
              Files will be uploaded to current folder
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

async function processDirectory(
  entry: FileSystemDirectoryEntry,
  path = ''
): Promise<void> {
  const reader = entry.createReader();
  const entries = await new Promise<FileSystemEntry[]>((resolve) => {
    reader.readEntries(resolve);
  });

  for (const childEntry of entries) {
    if (childEntry.isFile) {
      const file = await new Promise<File>((resolve) => {
        (childEntry as FileSystemFileEntry).file(resolve);
      });
      // Create folder structure and add upload
      addUploadWithPath(file, `${path}/${entry.name}`);
    } else if (childEntry.isDirectory) {
      await processDirectory(
        childEntry as FileSystemDirectoryEntry,
        `${path}/${entry.name}`
      );
    }
  }
}
```

## Deep Dive: Real-Time Sync with WebSocket

### WebSocket Connection Manager

```typescript
// services/syncService.ts
class SyncService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect() {
    this.ws = new WebSocket(`${WS_BASE_URL}/api/v1/sync/ws`);

    this.ws.onopen = () => {
      console.log('Sync connected');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleSyncMessage(message);
    };

    this.ws.onclose = () => {
      this.handleDisconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private handleSyncMessage(message: SyncEvent) {
    const { currentFolderId, refreshCurrentFolder } = useFileStore.getState();

    switch (message.type) {
      case 'file_created':
      case 'file_updated':
      case 'file_deleted':
        // Refresh if change affects current view
        if (message.folderId === currentFolderId) {
          refreshCurrentFolder();
        }
        // Show notification
        showSyncNotification(message);
        break;

      case 'sync_conflict':
        showConflictDialog(message);
        break;
    }
  }

  private handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.pow(2, this.reconnectAttempts) * 1000;
      setTimeout(() => this.connect(), delay);
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}

export const syncService = new SyncService();
```

### Sync Notification Component

```tsx
// components/sync/SyncNotification.tsx
function SyncNotification({ message }: { message: SyncEvent }) {
  const actionText = {
    file_created: 'added',
    file_updated: 'modified',
    file_deleted: 'deleted',
    folder_created: 'created folder',
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-lg shadow-lg border">
      <Cloud className="w-5 h-5 text-blue-500" />
      <div>
        <p className="text-sm font-medium">
          {message.filename} {actionText[message.type]}
        </p>
        <p className="text-xs text-gray-500">
          Synced from another device
        </p>
      </div>
    </div>
  );
}
```

## Deep Dive: Share Dialog

### Share Modal

```tsx
// components/sharing/ShareModal.tsx
function ShareModal({ item, onClose }: ShareModalProps) {
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [linkSettings, setLinkSettings] = useState({
    password: '',
    expiresIn: 'never',
    maxDownloads: null as number | null,
  });
  const [isCreating, setIsCreating] = useState(false);

  const createShareLink = async () => {
    setIsCreating(true);
    try {
      const result = await api.createShareLink(item.id, {
        password: linkSettings.password || undefined,
        expiresIn: linkSettings.expiresIn !== 'never'
          ? parseInt(linkSettings.expiresIn)
          : undefined,
        maxDownloads: linkSettings.maxDownloads || undefined,
      });
      setShareLink(result.url);
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      showToast('Link copied to clipboard');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-lg font-semibold">Share "{item.name}"</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Share link section */}
          {shareLink ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Share link
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={shareLink}
                  readOnly
                  className="flex-1 p-2 border rounded bg-gray-50"
                />
                <button
                  onClick={copyLink}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Copy
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Link settings */}
              <div>
                <label className="text-sm font-medium text-gray-700">
                  Password protection
                </label>
                <input
                  type="password"
                  placeholder="Optional password"
                  value={linkSettings.password}
                  onChange={(e) => setLinkSettings(s => ({
                    ...s,
                    password: e.target.value
                  }))}
                  className="w-full mt-1 p-2 border rounded"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">
                  Link expiration
                </label>
                <select
                  value={linkSettings.expiresIn}
                  onChange={(e) => setLinkSettings(s => ({
                    ...s,
                    expiresIn: e.target.value
                  }))}
                  className="w-full mt-1 p-2 border rounded"
                >
                  <option value="never">Never expires</option>
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                </select>
              </div>

              <button
                onClick={createShareLink}
                disabled={isCreating}
                className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {isCreating ? 'Creating...' : 'Create share link'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

## Accessibility (a11y)

### Keyboard Navigation

```tsx
// hooks/useKeyboardNavigation.ts
function useKeyboardNavigation() {
  const items = useFileStore(state => state.items);
  const selectedIds = useFileStore(state => state.selectedIds);
  const selectItem = useFileStore(state => state.selectItem);
  const navigateToFolder = useFileStore(state => state.navigateToFolder);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const currentIndex = items.findIndex(i =>
        selectedIds.has(i.id)
      );

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (currentIndex < items.length - 1) {
            selectItem(items[currentIndex + 1].id, e.shiftKey);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (currentIndex > 0) {
            selectItem(items[currentIndex - 1].id, e.shiftKey);
          }
          break;

        case 'Enter':
          const selected = items.find(i => selectedIds.has(i.id));
          if (selected?.type === 'folder') {
            navigateToFolder(selected.id);
          }
          break;

        case 'Delete':
        case 'Backspace':
          if (selectedIds.size > 0) {
            deleteSelected();
          }
          break;

        case 'a':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            selectAll();
          }
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [items, selectedIds]);
}
```

### Screen Reader Support

```tsx
<main role="application" aria-label="File browser">
  <nav aria-label="Breadcrumb navigation">
    <ol className="flex items-center gap-2">
      {breadcrumb.map((folder, index) => (
        <li key={folder.id}>
          <a
            href={`/folder/${folder.id}`}
            aria-current={index === breadcrumb.length - 1 ? 'page' : undefined}
          >
            {folder.name}
          </a>
        </li>
      ))}
    </ol>
  </nav>

  <div
    role="grid"
    aria-label={`${items.length} items in folder`}
  >
    {items.map((item, index) => (
      <div
        role="row"
        aria-rowindex={index + 1}
        aria-selected={selectedIds.has(item.id)}
      >
        <div role="gridcell">
          {item.name}
        </div>
      </div>
    ))}
  </div>
</main>
```

## Trade-offs Summary

| Decision | Pros | Cons |
|----------|------|------|
| Zustand over Redux | Minimal boilerplate, simple API | Less ecosystem |
| Web Crypto API for hashing | Native, no dependencies | Browser support varies |
| Client-side chunk hashing | Enables deduplication | CPU-intensive for large files |
| WebSocket for sync | Real-time updates | Connection management |
| Virtualized list | Handles 1000s of files | Complexity |
| Grid + List views | User preference | Two implementations |

## Future Frontend Enhancements

1. **Web Worker Hashing**: Move chunk hashing to worker thread
2. **IndexedDB Caching**: Offline file browser with cached metadata
3. **File Previews**: In-browser preview for images, PDFs, videos
4. **Bulk Operations**: Multi-select move, copy, delete with progress
5. **Search**: Full-text search with filters and facets
6. **Mobile App**: React Native with shared business logic
