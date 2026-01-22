import { useGalleryStore } from '../../stores/galleryStore'
import { imageIds, getImageUrl, getMasonryHeight } from '../../utils/picsum'

export function MasonryGrid() {
  const openLightbox = useGalleryStore((s) => s.openLightbox)

  return (
    <div className="columns-2 md:columns-3 lg:columns-4 gap-4">
      {imageIds.map((id) => {
        const height = getMasonryHeight(id, 400)
        return (
          <div key={id} className="break-inside-avoid mb-4">
            <button
              onClick={() => openLightbox(id)}
              className="block w-full rounded-lg overflow-hidden hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <img
                src={getImageUrl(id, 400, height)}
                alt={`Image ${id}`}
                loading="lazy"
                className="w-full h-auto"
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}
