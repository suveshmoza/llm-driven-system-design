import { create } from 'zustand'

export type TabType = 'Slideshow' | 'Masonry' | 'Tiles'

interface GalleryState {
  activeTab: TabType
  setActiveTab: (tab: TabType) => void

  // Lightbox state
  lightboxImage: number | null
  openLightbox: (imageId: number) => void
  closeLightbox: () => void

  // Slideshow state
  slideshowIndex: number
  setSlideshowIndex: (index: number) => void
  nextSlide: () => void
  prevSlide: () => void

  // Image count
  totalImages: number
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  activeTab: 'Tiles',
  setActiveTab: (tab) => set({ activeTab: tab }),

  lightboxImage: null,
  openLightbox: (imageId) => set({ lightboxImage: imageId }),
  closeLightbox: () => set({ lightboxImage: null }),

  slideshowIndex: 0,
  setSlideshowIndex: (index) => set({ slideshowIndex: index }),
  nextSlide: () => {
    const { slideshowIndex, totalImages } = get()
    set({ slideshowIndex: (slideshowIndex + 1) % totalImages })
  },
  prevSlide: () => {
    const { slideshowIndex, totalImages } = get()
    set({ slideshowIndex: (slideshowIndex - 1 + totalImages) % totalImages })
  },

  totalImages: 50,
}))
