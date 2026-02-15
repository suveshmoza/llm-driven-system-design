import { Link } from '@tanstack/react-router';

/** Renders quick action cards linking to Send, Request, and Activity pages. */
export function QuickActions() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Link
        to="/send"
        className="bg-white rounded-xl shadow-sm border border-paypal-border p-5 text-center hover:shadow-md transition-shadow"
      >
        <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-paypal-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </div>
        <span className="text-sm font-medium text-paypal-text">Send</span>
      </Link>

      <Link
        to="/request"
        className="bg-white rounded-xl shadow-sm border border-paypal-border p-5 text-center hover:shadow-md transition-shadow"
      >
        <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-paypal-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
          </svg>
        </div>
        <span className="text-sm font-medium text-paypal-text">Request</span>
      </Link>

      <Link
        to="/activity"
        className="bg-white rounded-xl shadow-sm border border-paypal-border p-5 text-center hover:shadow-md transition-shadow"
      >
        <div className="w-12 h-12 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <span className="text-sm font-medium text-paypal-text">Activity</span>
      </Link>
    </div>
  );
}
