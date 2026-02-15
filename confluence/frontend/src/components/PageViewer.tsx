interface PageViewerProps {
  html: string;
}

/** Renders wiki page HTML content with prose typography styling. */
export default function PageViewer({ html }: PageViewerProps) {
  return (
    <div
      className="wiki-content prose prose-sm max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
