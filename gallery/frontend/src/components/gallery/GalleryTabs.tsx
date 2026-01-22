import { useGalleryStore, type TabType } from '../../stores/galleryStore'

const tabs: TabType[] = ['Slideshow', 'Masonry', 'Tiles']

export function GalleryTabs() {
  const { activeTab, setActiveTab } = useGalleryStore()

  return (
    <div className="flex border-b border-gray-200 bg-white">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`px-6 py-4 font-medium text-sm transition-colors relative ${
            activeTab === tab
              ? 'text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab}
          {activeTab === tab && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
          )}
        </button>
      ))}
    </div>
  )
}
