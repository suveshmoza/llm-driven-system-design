import { useEffect, useCallback } from 'react'
import { useGalleryStore } from '../../stores/galleryStore'
import { imageIds, getImageUrl } from '../../utils/picsum'
import { XMarkIcon, ChevronLeftIcon, ChevronRightIcon } from '../icons'

export function Lightbox() {
  const { lightboxImage, closeLightbox, openLightbox } = useGalleryStore()

  const currentIndex = lightboxImage !== null ? imageIds.indexOf(lightboxImage) : -1

  const goToNext = useCallback(() => {
    if (currentIndex === -1) return
    const nextIndex = (currentIndex + 1) % imageIds.length
    openLightbox(imageIds[nextIndex])
  }, [currentIndex, openLightbox])

  const goToPrev = useCallback(() => {
    if (currentIndex === -1) return
    const prevIndex = (currentIndex - 1 + imageIds.length) % imageIds.length
    openLightbox(imageIds[prevIndex])
  }, [currentIndex, openLightbox])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (lightboxImage === null) return
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowLeft') goToPrev()
      if (e.key === 'ArrowRight') goToNext()
    },
    [lightboxImage, closeLightbox, goToNext, goToPrev]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    if (lightboxImage !== null) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [lightboxImage])

  if (lightboxImage === null) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={closeLightbox}
    >
      {/* Close button */}
      <button
        onClick={closeLightbox}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10"
        aria-label="Close lightbox"
      >
        <XMarkIcon className="w-6 h-6" />
      </button>

      {/* Navigation arrows */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          goToPrev()
        }}
        className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        aria-label="Previous image"
      >
        <ChevronLeftIcon className="w-8 h-8" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          goToNext()
        }}
        className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        aria-label="Next image"
      >
        <ChevronRightIcon className="w-8 h-8" />
      </button>

      {/* Image */}
      <img
        src={getImageUrl(lightboxImage, 1920, 1080)}
        alt={`Image ${lightboxImage}`}
        className="max-w-[90vw] max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Image counter */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 text-white text-sm">
        {currentIndex + 1} / {imageIds.length}
      </div>
    </div>
  )
}
