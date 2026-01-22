# LinkedIn - System Design Answer (Frontend Focus)

*45-minute system design interview format - Frontend Engineer Position*

## Problem Statement

Design LinkedIn, a professional social network where users build career profiles, connect with colleagues, and discover job opportunities. The frontend challenge involves building a professional UI that efficiently displays complex profile data, handles social graph visualization, and provides responsive feed interactions.

## Requirements Clarification

### Functional Requirements
- **Profiles**: Rich profile pages with experience, education, skills, activity
- **Connections**: Request handling, network visualization, PYMK display
- **Feed**: Algorithmic post ranking with engagement actions
- **Jobs**: Job listings with search, filtering, and application flow
- **Search**: Global search across people, companies, and jobs
- **Notifications**: Real-time updates for connection requests and engagement

### Non-Functional Requirements
- **Performance**: < 200ms first contentful paint for feed
- **Accessibility**: WCAG 2.1 AA compliance for professional platform
- **Responsiveness**: Desktop-first with mobile support
- **Offline**: Graceful degradation for poor connectivity

### User Experience Goals
- Professional, trustworthy aesthetic
- Clear hierarchy in complex profile layouts
- Seamless connection request flow
- Efficient job application process

## High-Level Architecture

```
+-----------------------------------------------------------+
|                     React Application                      |
|                   (TypeScript + Vite)                      |
+-----------------------------------------------------------+
         |                    |                    |
         v                    v                    v
+---------------+    +---------------+    +---------------+
| TanStack       |    |   Zustand     |    | Services/API  |
| Router         |    |   Store       |    | Layer         |
| - File-based   |    | - Auth state  |    | - REST calls  |
| - Type-safe    |    | - User data   |    | - Error handling|
| - Dynamic      |    | - UI state    |    | - Caching     |
+---------------+    +---------------+    +---------------+
         |                    |                    |
         v                    v                    v
+-----------------------------------------------------------+
|                    Component Layer                         |
| Profile | Feed | Network | Jobs | Search | Navbar         |
+-----------------------------------------------------------+
         |
         v
+-----------------------------------------------------------+
|                    Tailwind CSS                            |
|          (Utility-first, Professional Design)              |
+-----------------------------------------------------------+
```

## Deep Dives

### 1. Component Architecture

The application uses a hierarchical component structure with feature-based organization:

```
frontend/src/
├── components/
│   ├── profile/           # Profile page sub-components
│   │   ├── index.ts       # Barrel export
│   │   ├── ProfileHeader.tsx
│   │   ├── EditProfileModal.tsx
│   │   ├── ExperienceSection.tsx
│   │   ├── EducationSection.tsx
│   │   ├── SkillsSection.tsx
│   │   └── ActivitySection.tsx
│   ├── ConnectionCard.tsx
│   ├── JobCard.tsx
│   ├── PostCard.tsx
│   └── Navbar.tsx
├── routes/
│   ├── __root.tsx         # Layout with navbar
│   ├── index.tsx          # Feed
│   ├── profile.$userId.tsx
│   ├── network.tsx
│   ├── jobs.tsx
│   └── search.tsx
├── services/
│   └── api.ts             # API client
├── stores/
│   └── authStore.ts       # Auth state
└── types/
    └── index.ts           # Shared types
```

**Profile Page Refactoring Example:**

The profile page was refactored from a single 534-line component to focused sub-components:

| Component | Lines | Responsibility |
|-----------|-------|----------------|
| `ProfileHeader` | ~150 | Banner, avatar, name, connection actions |
| `EditProfileModal` | ~160 | Profile editing form |
| `ExperienceSection` | ~115 | Work history with add action |
| `EducationSection` | ~110 | Education list with add action |
| `SkillsSection` | ~195 | Skills with endorse/add/remove |
| `ActivitySection` | ~40 | User's posts feed |

**Barrel Export Pattern:**

```typescript
// components/profile/index.ts
export { ProfileHeader } from './ProfileHeader';
export { EditProfileModal } from './EditProfileModal';
export { ProfileAbout } from './ProfileAbout';
export { ExperienceSection } from './ExperienceSection';
export { EducationSection } from './EducationSection';
export { SkillsSection } from './SkillsSection';
export { ActivitySection } from './ActivitySection';

// Usage in route
import {
  ProfileHeader,
  EditProfileModal,
  ExperienceSection,
  SkillsSection,
} from '../components/profile';
```

### 2. State Management with Zustand

**Auth Store:**

```typescript
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    set({ user: response.data.user, isAuthenticated: true });
  },

  logout: async () => {
    await api.post('/auth/logout');
    set({ user: null, isAuthenticated: false });
  },

  updateUser: (updates) => {
    const currentUser = get().user;
    if (currentUser) {
      set({ user: { ...currentUser, ...updates } });
    }
  },

  checkSession: async () => {
    try {
      const response = await api.get('/auth/me');
      set({ user: response.data.user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
```

**Local State for UI:**

```typescript
// Profile page local state
const [profile, setProfile] = useState<User | null>(null);
const [isOwnProfile, setIsOwnProfile] = useState(false);
const [connectionDegree, setConnectionDegree] = useState<number | null>(null);
const [mutualConnections, setMutualConnections] = useState<User[]>([]);
const [showEditModal, setShowEditModal] = useState(false);
const [loading, setLoading] = useState(true);
```

### 3. Profile Page Layout

**ProfileHeader Component:**

```tsx
interface ProfileHeaderProps {
  profile: User;
  isOwnProfile: boolean;
  connectionDegree: number | null;
  mutualConnections: User[];
  onConnect: () => void;
  onEdit: () => void;
}

export function ProfileHeader({
  profile,
  isOwnProfile,
  connectionDegree,
  mutualConnections,
  onConnect,
  onEdit,
}: ProfileHeaderProps) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Banner */}
      <div className="h-48 bg-gradient-to-r from-linkedin-blue to-linkedin-dark" />

      {/* Avatar and Info */}
      <div className="px-6 pb-6 -mt-16 relative">
        <img
          src={profile.profileImageUrl || '/default-avatar.png'}
          alt={`${profile.firstName} ${profile.lastName}`}
          className="w-32 h-32 rounded-full border-4 border-white"
        />

        <div className="mt-4 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {profile.firstName} {profile.lastName}
            </h1>
            <p className="text-lg text-gray-600">{profile.headline}</p>
            <p className="text-sm text-gray-500 mt-1">
              {profile.location} · {profile.connectionCount} connections
            </p>

            {/* Mutual connections badge */}
            {connectionDegree === 2 && mutualConnections.length > 0 && (
              <p className="text-sm text-linkedin-blue mt-2">
                {mutualConnections.length} mutual connections
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {isOwnProfile ? (
              <button
                onClick={onEdit}
                className="px-4 py-2 border border-linkedin-blue text-linkedin-blue rounded-full hover:bg-linkedin-light"
              >
                Edit Profile
              </button>
            ) : (
              <button
                onClick={onConnect}
                disabled={connectionDegree === 1}
                className="px-4 py-2 bg-linkedin-blue text-white rounded-full hover:bg-linkedin-dark disabled:opacity-50"
              >
                {connectionDegree === 1 ? 'Connected' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 4. Skills Section with Endorsements

```tsx
interface SkillsSectionProps {
  skills: Skill[];
  isOwnProfile: boolean;
  onAddSkill: (skillName: string) => void;
  onRemoveSkill: (skillId: number) => void;
  onEndorse: (skillId: number) => void;
}

export function SkillsSection({
  skills,
  isOwnProfile,
  onAddSkill,
  onRemoveSkill,
  onEndorse,
}: SkillsSectionProps) {
  const [newSkill, setNewSkill] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (newSkill.trim()) {
      onAddSkill(newSkill.trim());
      setNewSkill('');
      setShowAddForm(false);
    }
  };

  return (
    <section className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Skills</h2>
        {isOwnProfile && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-linkedin-blue hover:text-linkedin-dark"
            aria-label="Add skill"
          >
            <Plus className="w-5 h-5" />
          </button>
        )}
      </div>

      {showAddForm && (
        <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
          <input
            type="text"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            placeholder="Enter skill name"
            className="flex-1 px-3 py-2 border rounded-md focus:ring-linkedin-blue focus:border-linkedin-blue"
            autoFocus
          />
          <button
            type="submit"
            className="px-4 py-2 bg-linkedin-blue text-white rounded-md hover:bg-linkedin-dark"
          >
            Add
          </button>
        </form>
      )}

      <ul className="space-y-3">
        {skills.map((skill) => (
          <li
            key={skill.id}
            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
          >
            <div>
              <span className="font-medium">{skill.name}</span>
              {skill.endorsementCount > 0 && (
                <span className="ml-2 text-sm text-gray-500">
                  {skill.endorsementCount} endorsements
                </span>
              )}
            </div>

            <div className="flex gap-2">
              {!isOwnProfile && (
                <button
                  onClick={() => onEndorse(skill.id)}
                  className="text-sm text-linkedin-blue hover:underline"
                >
                  Endorse
                </button>
              )}
              {isOwnProfile && (
                <button
                  onClick={() => onRemoveSkill(skill.id)}
                  className="text-gray-400 hover:text-red-500"
                  aria-label={`Remove ${skill.name}`}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

### 5. Feed with Ranking Display

```tsx
interface PostCardProps {
  post: Post;
  onLike: (postId: number) => void;
  onComment: (postId: number, content: string) => void;
}

export function PostCard({ post, onLike, onComment }: PostCardProps) {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');

  return (
    <article className="bg-white rounded-lg shadow p-4">
      {/* Author header */}
      <div className="flex items-start gap-3 mb-3">
        <Link to={`/profile/${post.author.id}`}>
          <img
            src={post.author.profileImageUrl || '/default-avatar.png'}
            alt=""
            className="w-12 h-12 rounded-full"
          />
        </Link>
        <div className="flex-1">
          <Link
            to={`/profile/${post.author.id}`}
            className="font-semibold hover:underline"
          >
            {post.author.firstName} {post.author.lastName}
          </Link>
          <p className="text-sm text-gray-500">{post.author.headline}</p>
          <p className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(post.createdAt))} ago
          </p>
        </div>
      </div>

      {/* Content */}
      <p className="text-gray-800 whitespace-pre-wrap mb-4">{post.content}</p>

      {post.imageUrl && (
        <img
          src={post.imageUrl}
          alt=""
          className="w-full rounded-lg mb-4"
        />
      )}

      {/* Engagement stats */}
      <div className="flex items-center text-sm text-gray-500 pb-3 border-b">
        <span>{post.likeCount} likes</span>
        <span className="mx-2">·</span>
        <button
          onClick={() => setShowComments(!showComments)}
          className="hover:text-linkedin-blue"
        >
          {post.commentCount} comments
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex justify-around pt-2">
        <button
          onClick={() => onLike(post.id)}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <ThumbsUp className="w-5 h-5" />
          Like
        </button>
        <button
          onClick={() => setShowComments(true)}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <MessageSquare className="w-5 h-5" />
          Comment
        </button>
        <button className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
          <Share2 className="w-5 h-5" />
          Share
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div className="mt-4 pt-4 border-t">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (commentText.trim()) {
                onComment(post.id, commentText);
                setCommentText('');
              }
            }}
            className="flex gap-2 mb-4"
          >
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              className="flex-1 px-3 py-2 border rounded-full focus:ring-linkedin-blue"
            />
            <button
              type="submit"
              disabled={!commentText.trim()}
              className="px-4 py-2 bg-linkedin-blue text-white rounded-full disabled:opacity-50"
            >
              Post
            </button>
          </form>

          {/* Comment list */}
          <ul className="space-y-3">
            {post.comments?.map((comment) => (
              <li key={comment.id} className="flex gap-2">
                <img
                  src={comment.author.profileImageUrl || '/default-avatar.png'}
                  alt=""
                  className="w-8 h-8 rounded-full"
                />
                <div className="flex-1 bg-gray-100 rounded-lg p-3">
                  <Link
                    to={`/profile/${comment.author.id}`}
                    className="font-semibold text-sm hover:underline"
                  >
                    {comment.author.firstName} {comment.author.lastName}
                  </Link>
                  <p className="text-sm">{comment.content}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
```

### 6. PYMK (People You May Know) Display

```tsx
interface PYMKCardProps {
  user: User;
  mutualCount: number;
  onConnect: (userId: number) => void;
}

export function PYMKCard({ user, mutualCount, onConnect }: PYMKCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-4 text-center">
      <Link to={`/profile/${user.id}`}>
        <img
          src={user.profileImageUrl || '/default-avatar.png'}
          alt=""
          className="w-20 h-20 rounded-full mx-auto mb-3"
        />
        <h3 className="font-semibold hover:underline">
          {user.firstName} {user.lastName}
        </h3>
      </Link>
      <p className="text-sm text-gray-600 mb-2 line-clamp-2">
        {user.headline}
      </p>
      <p className="text-xs text-gray-500 mb-3">
        {mutualCount} mutual connections
      </p>
      <button
        onClick={() => onConnect(user.id)}
        className="w-full px-4 py-2 border border-linkedin-blue text-linkedin-blue rounded-full hover:bg-linkedin-light"
      >
        Connect
      </button>
    </div>
  );
}

// Network page with PYMK grid
function NetworkPage() {
  const [pymkList, setPymkList] = useState<PYMKUser[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ConnectionRequest[]>([]);

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      {/* Pending requests */}
      {pendingRequests.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">
            Invitations ({pendingRequests.length})
          </h2>
          <div className="space-y-3">
            {pendingRequests.map((request) => (
              <ConnectionRequestCard
                key={request.id}
                request={request}
                onAccept={() => handleAccept(request.id)}
                onDecline={() => handleDecline(request.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* PYMK section */}
      <section>
        <h2 className="text-xl font-bold mb-4">People you may know</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {pymkList.map((pymk) => (
            <PYMKCard
              key={pymk.user.id}
              user={pymk.user}
              mutualCount={pymk.mutualCount}
              onConnect={handleConnect}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
```

### 7. Accessibility Considerations

**Key Accessibility Patterns:**

```tsx
// Icon-only buttons need aria-label
<button
  onClick={onEdit}
  aria-label="Edit profile"
  className="p-2 text-gray-500 hover:text-linkedin-blue"
>
  <Pencil className="w-5 h-5" />
</button>

// Form inputs with labels
<label htmlFor="headline" className="block text-sm font-medium mb-1">
  Headline
</label>
<input
  id="headline"
  type="text"
  value={headline}
  onChange={(e) => setHeadline(e.target.value)}
  className="w-full px-3 py-2 border rounded-md"
/>

// Focus management in modals
useEffect(() => {
  if (isOpen) {
    // Save current focus
    previousFocus.current = document.activeElement as HTMLElement;
    // Focus first input
    firstInputRef.current?.focus();
  }
  return () => {
    // Restore focus on close
    previousFocus.current?.focus();
  };
}, [isOpen]);

// Keyboard navigation for skill list
<ul role="list" aria-label="Skills">
  {skills.map((skill) => (
    <li key={skill.id} role="listitem">
      {skill.name}
    </li>
  ))}
</ul>
```

### 8. Loading and Error States

```tsx
function ProfilePage() {
  const { userId } = Route.useParams();
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        setLoading(true);
        setError(null);
        const data = await usersApi.getProfile(parseInt(userId));
        setProfile(data);
      } catch (err) {
        setError('Failed to load profile. Please try again.');
        console.error('Profile load error:', err);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [userId]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-8">
        <ProfileSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto py-8 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-linkedin-blue text-white rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto py-8 text-center">
        <p className="text-gray-600">Profile not found</p>
      </div>
    );
  }

  return <ProfileContent profile={profile} />;
}

// Skeleton component for loading state
function ProfileSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-48 bg-gray-200 rounded-t-lg" />
      <div className="bg-white rounded-b-lg p-6">
        <div className="w-32 h-32 bg-gray-200 rounded-full -mt-20" />
        <div className="mt-4 space-y-3">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
          <div className="h-4 bg-gray-200 rounded w-1/4" />
        </div>
      </div>
    </div>
  );
}
```

## Trade-offs Summary

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| State management | Zustand | Redux, Context | Simpler API, less boilerplate |
| Routing | TanStack Router | React Router | Type-safe, file-based |
| Styling | Tailwind CSS | CSS Modules, Styled Components | Rapid development, consistency |
| Component size | Max 200 lines | Larger components | Maintainability, testability |
| Form handling | Controlled inputs | React Hook Form | Simpler for moderate forms |
| Data fetching | useEffect + fetch | TanStack Query | Sufficient for current scope |
| Icons | Lucide React | Custom SVGs, FontAwesome | Tree-shakeable, consistent |

## Future Enhancements

1. **TanStack Query**: Add for caching, background refetch, and optimistic updates
2. **Virtual scrolling**: Implement for long connection lists and feed
3. **Real-time updates**: WebSocket for live notifications and feed updates
4. **Rich text editor**: For post creation with formatting
5. **Profile completeness indicator**: Visual progress for incomplete profiles
6. **Keyboard shortcuts**: Power user navigation (j/k for feed, n for new post)
7. **Dark mode**: Professional dark theme option
8. **Offline support**: Service worker for offline profile viewing
