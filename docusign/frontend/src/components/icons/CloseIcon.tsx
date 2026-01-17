/**
 * Close/X icon component.
 * Displays an X symbol, typically used for close buttons or dismissal actions.
 *
 * @param props - Standard SVG element props
 * @returns An SVG element representing a close/X icon
 */
export function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
