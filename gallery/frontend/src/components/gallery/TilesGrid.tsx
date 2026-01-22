import { useGalleryStore } from '../../stores/galleryStore'
import { imageIds, getImageUrl } from '../../utils/picsum'

export function TilesGrid() {
  const openLightbox = useGalleryStore((s) => s.openLightbox)

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {imageIds.map((id) => (
        <button
          key={id}
          onClick={() => openLightbox(id)}
          className="aspect-square overflow-hidden rounded-lg group focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <img
            src={getImageUrl(id, 300, 300)}
            alt={`Image ${id}`}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </button>
      ))}
    </div>
  )
}
