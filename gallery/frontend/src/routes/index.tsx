import { createFileRoute } from '@tanstack/react-router'
import { GalleryTabs } from '../components/gallery/GalleryTabs'
import { useGalleryStore } from '../stores/galleryStore'
import { Slideshow } from '../components/gallery/Slideshow'
import { MasonryGrid } from '../components/gallery/MasonryGrid'
import { TilesGrid } from '../components/gallery/TilesGrid'

export const Route = createFileRoute('/')({
  component: GalleryPage,
})

function GalleryPage() {
  const activeTab = useGalleryStore((s) => s.activeTab)

  return (
    <div>
      <GalleryTabs />
      <div className="p-4">
        {activeTab === 'Slideshow' && <Slideshow />}
        {activeTab === 'Masonry' && <MasonryGrid />}
        {activeTab === 'Tiles' && <TilesGrid />}
      </div>
    </div>
  )
}
