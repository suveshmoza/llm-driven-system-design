import { logger } from './logger.js';

interface MacroNode {
  type: string;
  attrs?: Record<string, string>;
  content?: string;
}

interface ExpandedMacro {
  type: string;
  html: string;
}

/**
 * Expands macro nodes in content_json into rendered HTML.
 * Supported macros: info, warning, note, code, toc
 */
export function expandMacro(macro: MacroNode): ExpandedMacro {
  switch (macro.type) {
    case 'info':
      return {
        type: 'info',
        html: `<div class="macro-info" style="background:#DEEBFF;border-left:4px solid #0052CC;padding:12px 16px;border-radius:4px;margin:8px 0;">
          <strong style="color:#0052CC;">ℹ Info</strong>
          <div style="margin-top:4px;">${escapeHtml(macro.content || '')}</div>
        </div>`,
      };

    case 'warning':
      return {
        type: 'warning',
        html: `<div class="macro-warning" style="background:#FFFAE6;border-left:4px solid #FF8B00;padding:12px 16px;border-radius:4px;margin:8px 0;">
          <strong style="color:#FF8B00;">⚠ Warning</strong>
          <div style="margin-top:4px;">${escapeHtml(macro.content || '')}</div>
        </div>`,
      };

    case 'note':
      return {
        type: 'note',
        html: `<div class="macro-note" style="background:#EAE6FF;border-left:4px solid #6554C0;padding:12px 16px;border-radius:4px;margin:8px 0;">
          <strong style="color:#6554C0;">📝 Note</strong>
          <div style="margin-top:4px;">${escapeHtml(macro.content || '')}</div>
        </div>`,
      };

    case 'code':
      return {
        type: 'code',
        html: `<pre class="macro-code" style="background:#F4F5F7;border:1px solid #DFE1E6;border-radius:4px;padding:12px 16px;margin:8px 0;overflow-x:auto;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;">
          <code>${escapeHtml(macro.content || '')}</code>
        </pre>`,
      };

    case 'toc':
      return {
        type: 'toc',
        html: `<div class="macro-toc" style="background:#F4F5F7;border:1px solid #DFE1E6;border-radius:4px;padding:12px 16px;margin:8px 0;">
          <strong>📑 Table of Contents</strong>
          <div id="toc-placeholder" style="margin-top:8px;color:#6B778C;">[Generated from page headings]</div>
        </div>`,
      };

    default:
      logger.warn({ macroType: macro.type }, 'Unknown macro type');
      return {
        type: macro.type,
        html: `<div style="background:#FFEBE6;border-left:4px solid #DE350B;padding:12px 16px;border-radius:4px;margin:8px 0;">
          <strong style="color:#DE350B;">Unknown macro: ${escapeHtml(macro.type)}</strong>
        </div>`,
      };
  }
}

/** Expands all macro nodes in content_json and returns their rendered HTML strings. */
export function expandMacrosInContent(contentJson: { macros?: MacroNode[] }): string[] {
  if (!contentJson.macros || !Array.isArray(contentJson.macros)) return [];

  return contentJson.macros.map((macro) => {
    const expanded = expandMacro(macro);
    return expanded.html;
  });
}

/** Generates an HTML table of contents from h1-h3 headings in the page HTML. */
export function generateTableOfContents(html: string): string {
  const headingRegex = /<h([1-3])(?:\s[^>]*)?>(.*?)<\/h[1-3]>/gi;
  const headings: Array<{ level: number; text: string; id: string }> = [];
  let match;

  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1]);
    const text = match[2].replace(/<[^>]+>/g, '');
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    headings.push({ level, text, id });
  }

  if (headings.length === 0) return '';

  let tocHtml = '<nav class="table-of-contents"><ul style="list-style:none;padding:0;">';
  for (const heading of headings) {
    const indent = (heading.level - 1) * 16;
    tocHtml += `<li style="padding-left:${indent}px;margin:4px 0;">
      <a href="#${heading.id}" style="color:#0052CC;text-decoration:none;">${heading.text}</a>
    </li>`;
  }
  tocHtml += '</ul></nav>';

  return tocHtml;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
