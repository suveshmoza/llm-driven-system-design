/**
 * PDF document icon component.
 * Displays a styled PDF file icon, typically used to indicate document files.
 *
 * @param props - Standard SVG element props
 * @returns An SVG element representing a PDF document icon
 */
export function PdfIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20" {...props}>
      <path
        fillRule="evenodd"
        d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
        clipRule="evenodd"
      />
    </svg>
  );
}
