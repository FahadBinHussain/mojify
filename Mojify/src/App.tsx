import { useState } from "react";
import { ThemeProvider } from "./components/ThemeProvider";
import { Header } from "./components/Header";
import { SearchBar } from "./components/SearchBar";
import { EmoteGrid, Emote } from "./components/EmoteGrid";
import { Notification } from "./components/Notification";

// Mock data for testing
const mockEmotes: Emote[] = [
  {
    id: "1",
    name: "PogChamp",
    imageUrl: "https://cdn.7tv.app/emote/60ae958e229664e8667aea38/4x.webp",
    isAnimated: false,
  },
  {
    id: "2",
    name: "KEKW",
    imageUrl: "https://cdn.7tv.app/emote/60ae9df2b2ecb05e6a6b5610/4x.webp",
    isAnimated: false,
  },
  {
    id: "3",
    name: "pepeD",
    imageUrl: "https://cdn.7tv.app/emote/603caa69faf3a00014dff0b1/4x.webp",
    isAnimated: true,
  },
  {
    id: "4",
    name: "Sadge",
    imageUrl: "https://cdn.7tv.app/emote/60abf171870d317bef23d399/4x.webp",
    isAnimated: false,
  },
  {
    id: "5",
    name: "AYAYA",
    imageUrl: "https://cdn.7tv.app/emote/603cab8d7c9fae40e605ace7/4x.webp",
    isAnimated: false,
  },
  {
    id: "6",
    name: "catJAM",
    imageUrl: "https://cdn.7tv.app/emote/60ae4a875d3fdae583c64ce9/4x.webp",
    isAnimated: true,
  },
];

type GridSize = 'small' | 'medium' | 'large';

function App() {
  const [emotes, setEmotes] = useState<Emote[]>(mockEmotes);
  const [gridSize, setGridSize] = useState<GridSize>('medium');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [channelId, setChannelId] = useState<string>('');

  const handleSearch = (query: string) => {
    if (!query) {
      setEmotes(mockEmotes);
      return;
    }
    
    const filtered = mockEmotes.filter(emote => 
      emote.name.toLowerCase().includes(query.toLowerCase())
    );
    setEmotes(filtered);
  };

  const handleEmoteClick = (emote: Emote) => {
    // In a real app, this would copy the emote to clipboard
    console.log(`Copying emote: ${emote.name}`);
    
    // Show notification
    setNotification({
      message: `Copied ${emote.name} to clipboard!`,
      type: 'success'
    });
  };

  const handleGridSizeChange = (size: GridSize) => {
    setGridSize(size);
    setNotification({
      message: `Grid size changed to ${size}`,
      type: 'info'
    });
  };

  const handleChannelIdChange = (id: string) => {
    setChannelId(id);
    // In a real app, this would trigger fetching emotes from the specified channel
    console.log(`Channel ID changed to: ${id}`);
  };

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <Header 
          gridSize={gridSize}
          onGridSizeChange={handleGridSizeChange}
          channelId={channelId}
          onChannelIdChange={handleChannelIdChange}
        />
        
        <main className="container mx-auto py-6 px-4">
          <div className="mb-6">
            <SearchBar onSearch={handleSearch} />
          </div>
          
          <EmoteGrid 
            emotes={emotes} 
            onEmoteClick={handleEmoteClick} 
            gridSize={gridSize}
          />
          
          {notification && (
            <Notification
              message={notification.message}
              type={notification.type}
              onClose={() => setNotification(null)}
            />
          )}
        </main>
      </div>
    </ThemeProvider>
  );
}

export default App;
