import type {
  User,
  Space,
  Page,
  PageTreeNode,
  PageVersion,
  DiffResult,
  Comment,
  Template,
  Approval,
  SearchResult,
} from '../types';

const API_BASE = '/api/v1';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
export async function register(username: string, email: string, password: string): Promise<{ user: User }> {
  return request(`${API_BASE}/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
}

export async function login(username: string, password: string): Promise<{ user: User }> {
  return request(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(): Promise<void> {
  await request(`${API_BASE}/auth/logout`, { method: 'POST' });
}

export async function getMe(): Promise<{ user: User }> {
  return request(`${API_BASE}/auth/me`);
}

// Spaces
export async function getSpaces(): Promise<{ spaces: Space[] }> {
  return request(`${API_BASE}/spaces`);
}

export async function getSpace(key: string): Promise<{ space: Space }> {
  return request(`${API_BASE}/spaces/${key}`);
}

export async function createSpace(data: { key: string; name: string; description?: string }): Promise<{ space: Space }> {
  return request(`${API_BASE}/spaces`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Pages
export async function getRecentPages(): Promise<{ pages: Page[] }> {
  return request(`${API_BASE}/pages/recent`);
}

export async function getPageTree(spaceKey: string): Promise<{ tree: PageTreeNode[] }> {
  return request(`${API_BASE}/pages/space/${spaceKey}/tree`);
}

export async function getPageBySlug(spaceKey: string, slug: string): Promise<{ page: Page }> {
  return request(`${API_BASE}/pages/space/${spaceKey}/slug/${slug}`);
}

export async function getPageById(id: string): Promise<{ page: Page }> {
  return request(`${API_BASE}/pages/${id}`);
}

export async function createPage(data: {
  spaceId: string;
  title: string;
  contentJson?: object;
  contentHtml?: string;
  contentText?: string;
  parentId?: string;
  status?: string;
}): Promise<{ page: Page }> {
  return request(`${API_BASE}/pages`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePage(
  id: string,
  data: {
    title: string;
    contentJson?: object;
    contentHtml?: string;
    contentText?: string;
    changeMessage?: string;
  },
): Promise<{ page: Page }> {
  return request(`${API_BASE}/pages/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deletePage(id: string): Promise<void> {
  await request(`${API_BASE}/pages/${id}`, { method: 'DELETE' });
}

export async function addLabel(pageId: string, label: string): Promise<void> {
  await request(`${API_BASE}/pages/${pageId}/labels`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

export async function removeLabel(pageId: string, label: string): Promise<void> {
  await request(`${API_BASE}/pages/${pageId}/labels/${label}`, { method: 'DELETE' });
}

// Versions
export async function getVersionHistory(pageId: string): Promise<{ versions: PageVersion[] }> {
  return request(`${API_BASE}/versions/${pageId}`);
}

export async function getVersionDiff(
  pageId: string,
  fromVersion: number,
  toVersion: number,
): Promise<{ diff: DiffResult }> {
  return request(`${API_BASE}/versions/${pageId}/diff?from=${fromVersion}&to=${toVersion}`);
}

export async function restoreVersion(pageId: string, versionNumber: number): Promise<void> {
  await request(`${API_BASE}/versions/${pageId}/restore`, {
    method: 'POST',
    body: JSON.stringify({ versionNumber }),
  });
}

// Search
export async function searchPages(
  query: string,
  spaceKey?: string,
): Promise<{ results: SearchResult[]; total: number; took: number }> {
  const params = new URLSearchParams({ q: query });
  if (spaceKey) params.set('space', spaceKey);
  return request(`${API_BASE}/search?${params}`);
}

// Comments
export async function getComments(pageId: string): Promise<{ comments: Comment[] }> {
  return request(`${API_BASE}/comments/page/${pageId}`);
}

export async function addComment(pageId: string, content: string, parentId?: string): Promise<{ comment: Comment }> {
  return request(`${API_BASE}/comments/page/${pageId}`, {
    method: 'POST',
    body: JSON.stringify({ content, parentId }),
  });
}

export async function deleteComment(id: string): Promise<void> {
  await request(`${API_BASE}/comments/${id}`, { method: 'DELETE' });
}

export async function resolveComment(id: string): Promise<{ comment: Comment }> {
  return request(`${API_BASE}/comments/${id}/resolve`, { method: 'POST' });
}

// Templates
export async function getTemplates(spaceId?: string): Promise<{ templates: Template[] }> {
  const params = spaceId ? `?spaceId=${spaceId}` : '';
  return request(`${API_BASE}/templates${params}`);
}

// Approvals
export async function requestApproval(pageId: string): Promise<{ approval: Approval }> {
  return request(`${API_BASE}/approvals/request`, {
    method: 'POST',
    body: JSON.stringify({ pageId }),
  });
}

export async function reviewApproval(
  id: string,
  status: 'approved' | 'rejected',
  comment?: string,
): Promise<{ approval: Approval }> {
  return request(`${API_BASE}/approvals/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({ status, comment }),
  });
}

export async function getPendingApprovals(): Promise<{ approvals: Approval[] }> {
  return request(`${API_BASE}/approvals/pending`);
}

export async function getPageApprovals(pageId: string): Promise<{ approvals: Approval[] }> {
  return request(`${API_BASE}/approvals/page/${pageId}`);
}
