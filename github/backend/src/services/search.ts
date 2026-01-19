import esClient from '../db/elasticsearch.js';
import * as gitService from './git.js';

interface SearchTotalHits {
  value: number;
  relation: string;
}

interface CodeDocument {
  repo_id: string;
  repo_name: string;
  owner: string;
  path: string;
  filename: string;
  extension: string;
  language: string;
  content: string;
  symbols: Symbol[];
  indexed_at: string;
}

interface Symbol {
  name: string;
  kind: string;
  line: number;
}

interface SearchFilters {
  language?: string;
  repo?: string;
  path?: string;
  owner?: string;
  page?: number;
  limit?: number;
  kind?: string;
}

interface TreeItem {
  type: string;
  name: string;
  path: string;
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  css: 'css',
  scss: 'scss',
  html: 'html',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
};

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_EXTENSIONS[ext] || 'unknown';
}

/**
 * Extract simple symbols from code (basic implementation)
 */
function extractSymbols(content: string, language: string): Symbol[] {
  const symbols: Symbol[] = [];
  const lines = content.split('\n');

  // Function patterns for common languages
  const patterns: Record<string, RegExp> = {
    javascript: /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\(|\w+\s*=>))/g,
    typescript: /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\(|\w+\s*=>)|class\s+(\w+))/g,
    python: /(?:def\s+(\w+)|class\s+(\w+))/g,
    go: /(?:func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+))/g,
    rust: /(?:fn\s+(\w+)|struct\s+(\w+)|impl\s+(\w+))/g,
    java: /(?:(?:public|private|protected)?\s*(?:static\s+)?(?:class|interface|enum)\s+(\w+)|(?:public|private|protected)?\s*(?:static\s+)?[\w<>[\]]+\s+(\w+)\s*\()/g,
  };

  const pattern = patterns[language];
  if (!pattern) return symbols;

  lines.forEach((line, index) => {
    let match;
    const regex = new RegExp(pattern.source, 'g');
    while ((match = regex.exec(line)) !== null) {
      const name = match.slice(1).find((m) => m);
      if (name) {
        symbols.push({
          name,
          kind: line.includes('class') || line.includes('struct') ? 'class' : 'function',
          line: index + 1,
        });
      }
    }
  });

  return symbols;
}

/**
 * Index a single file
 */
export async function indexFile(repoId: number, owner: string, repoName: string, filePath: string, content: string): Promise<void> {
  const language = detectLanguage(filePath);
  const filename = filePath.split('/').pop() || '';
  const extension = filename.includes('.') ? filename.split('.').pop() || '' : '';

  const symbols = extractSymbols(content, language);

  await esClient.index({
    index: 'code',
    id: `${repoId}:${filePath}`,
    body: {
      repo_id: repoId.toString(),
      repo_name: repoName,
      owner,
      path: filePath,
      filename,
      extension,
      language,
      content,
      symbols,
      indexed_at: new Date().toISOString(),
    },
  });
}

/**
 * Index all files in a repository
 */
export async function indexRepository(repoId: number, owner: string, repoName: string): Promise<void> {
  const indexFileRecursive = async (treePath: string = ''): Promise<void> => {
    const tree = await gitService.getTree(owner, repoName, 'HEAD', treePath) as TreeItem[];

    for (const item of tree) {
      if (item.type === 'dir') {
        await indexFileRecursive(item.path);
      } else if (item.type === 'file') {
        // Only index text files (skip binary)
        const ext = item.name.split('.').pop()?.toLowerCase() || '';
        if (LANGUAGE_EXTENSIONS[ext] || ['txt', 'md', 'json', 'xml', 'yaml', 'yml'].includes(ext)) {
          try {
            const content = await gitService.getFileContent(owner, repoName, 'HEAD', item.path);
            if (content && content.length < 1000000) {
              // Skip files > 1MB
              await indexFile(repoId, owner, repoName, item.path, content);
            }
          } catch (err) {
            console.error(`Failed to index ${item.path}:`, err);
          }
        }
      }
    }
  };

  await indexFileRecursive();
}

/**
 * Remove all indexed files for a repository
 */
export async function removeRepositoryIndex(repoId: number): Promise<void> {
  await esClient.deleteByQuery({
    index: 'code',
    body: {
      query: {
        term: { repo_id: repoId.toString() },
      },
    },
  });
}

/**
 * Search code across repositories
 */
export async function searchCode(queryText: string, filters: SearchFilters = {}) {
  const { language, repo, path: pathFilter, owner, page = 1, limit = 20 } = filters;

  const must: object[] = [{ match: { content: queryText } }];

  const filter: object[] = [];
  if (language) filter.push({ term: { language } });
  if (repo) filter.push({ term: { repo_name: repo } });
  if (owner) filter.push({ term: { owner } });
  if (pathFilter) filter.push({ wildcard: { path: `*${pathFilter}*` } });

  const response = await esClient.search<CodeDocument>({
    index: 'code',
    body: {
      query: {
        bool: {
          must,
          filter,
        },
      },
      highlight: {
        fields: {
          content: {
            fragment_size: 150,
            number_of_fragments: 3,
          },
        },
      },
      from: (page - 1) * limit,
      size: limit,
    },
  });

  const total = response.hits.total as SearchTotalHits;
  return {
    total: total?.value || 0,
    results: response.hits.hits.map((hit) => ({
      repo_id: hit._source?.repo_id,
      repo_name: hit._source?.repo_name,
      owner: hit._source?.owner,
      path: hit._source?.path,
      language: hit._source?.language,
      highlights: hit.highlight?.content || [],
      score: hit._score,
    })),
  };
}

/**
 * Search for symbols
 */
export async function searchSymbols(symbolName: string, filters: SearchFilters = {}) {
  const { language, repo, owner, kind, page = 1, limit = 20 } = filters;

  const must: object[] = [
    {
      nested: {
        path: 'symbols',
        query: {
          bool: {
            must: [{ match: { 'symbols.name': symbolName } }],
            filter: kind ? [{ term: { 'symbols.kind': kind } }] : [],
          },
        },
        inner_hits: {},
      },
    },
  ];

  const filter: object[] = [];
  if (language) filter.push({ term: { language } });
  if (repo) filter.push({ term: { repo_name: repo } });
  if (owner) filter.push({ term: { owner } });

  const response = await esClient.search<CodeDocument>({
    index: 'code',
    body: {
      query: {
        bool: { must, filter },
      },
      from: (page - 1) * limit,
      size: limit,
    },
  });

  const total = response.hits.total as SearchTotalHits;
  return {
    total: total?.value || 0,
    results: response.hits.hits.map((hit) => ({
      repo_id: hit._source?.repo_id,
      repo_name: hit._source?.repo_name,
      owner: hit._source?.owner,
      path: hit._source?.path,
      language: hit._source?.language,
      symbols: hit.inner_hits?.symbols?.hits?.hits?.map((s) => s._source) || [],
    })),
  };
}
