import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Lightbox } from '../components/gallery/Lightbox'

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Gallery</h1>
          <p className="text-sm text-gray-500 mt-1">
            Image gallery with Slideshow, Masonry, and Tiles views
          </p>
        </div>
      </header>
      <main className="max-w-7xl mx-auto">
        <Outlet />
      </main>
      <Lightbox />
    </div>
  ),
})
