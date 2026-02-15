interface PageViewerProps {
  html: string;
}

export default function PageViewer({ html }: PageViewerProps) {
  return (
    <div
      className="wiki-content prose prose-sm max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
