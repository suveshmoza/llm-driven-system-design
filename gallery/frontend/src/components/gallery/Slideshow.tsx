import { useEffect, useCallback } from 'react'
import { useGalleryStore } from '../../stores/galleryStore'
import { imageIds, getImageUrl } from '../../utils/picsum'
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, PauseIcon } from '../icons'
import { useState } from 'react'

export function Slideshow() {
  const { slideshowIndex, setSlideshowIndex, nextSlide, prevSlide } = useGalleryStore()
  const [isPlaying, setIsPlaying] = useState(false)

  const currentImageId = imageIds[slideshowIndex]

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prevSlide()
      if (e.key === 'ArrowRight') nextSlide()
      if (e.key === ' ') {
        e.preventDefault()
        setIsPlaying((p) => !p)
      }
    },
    [nextSlide, prevSlide]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Auto-play
  useEffect(() => {
    if (!isPlaying) return
    const interval = setInterval(nextSlide, 3000)
    return () => clearInterval(interval)
  }, [isPlaying, nextSlide])

  return (
    <div className="flex flex-col">
      {/* Main image area */}
      <div className="relative bg-gray-900 rounded-lg overflow-hidden">
        <div className="aspect-[16/9] flex items-center justify-center">
          <img
            src={getImageUrl(currentImageId, 1200, 675)}
            alt={`Image ${currentImageId}`}
            className="max-w-full max-h-full object-contain"
          />
        </div>

        {/* Navigation arrows */}
        <button
          onClick={prevSlide}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          aria-label="Previous image"
        >
          <ChevronLeftIcon className="w-6 h-6" />
        </button>
        <button
          onClick={nextSlide}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          aria-label="Next image"
        >
          <ChevronRightIcon className="w-6 h-6" />
        </button>

        {/* Play/Pause button */}
        <button
          onClick={() => setIsPlaying((p) => !p)}
          className="absolute bottom-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          aria-label={isPlaying ? 'Pause slideshow' : 'Play slideshow'}
        >
          {isPlaying ? (
            <PauseIcon className="w-5 h-5" />
          ) : (
            <PlayIcon className="w-5 h-5" />
          )}
        </button>

        {/* Image counter */}
        <div className="absolute bottom-4 left-4 px-3 py-1 rounded-full bg-black/50 text-white text-sm">
          {slideshowIndex + 1} / {imageIds.length}
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {imageIds.map((id, index) => (
          <button
            key={id}
            onClick={() => setSlideshowIndex(index)}
            className={`flex-shrink-0 w-20 h-14 rounded overflow-hidden transition-all ${
              index === slideshowIndex
                ? 'ring-2 ring-blue-500 ring-offset-2'
                : 'opacity-60 hover:opacity-100'
            }`}
          >
            <img
              src={getImageUrl(id, 80, 56)}
              alt={`Thumbnail ${id}`}
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  )
}
