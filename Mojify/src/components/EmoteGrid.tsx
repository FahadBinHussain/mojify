import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Define the Emote type
export interface Emote {
  id: string;
  name: string;
  imageUrl: string;
  isAnimated: boolean;
  localPath?: string; // Path to the local copy of the emote
}

interface EmoteGridProps {
  emotes: Emote[];
  onEmoteClick: (emote: Emote) => void;
  gridSize?: 'small' | 'medium' | 'large';
}

export function EmoteGrid({ 
  emotes, 
  onEmoteClick,
  gridSize = 'medium' 
}: EmoteGridProps) {
  const [hoveredEmote, setHoveredEmote] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<string | null>(null);
  
  // Function to handle copying emote to clipboard
  const handleEmoteClick = async (emote: Emote) => {
    try {
      setIsLoading(emote.id);
      
      // If we have a local path, use it directly
      if (emote.localPath) {
        await invoke('copy_image_to_clipboard', { imagePath: emote.localPath });
      } else {
        // In a real app, we would download the image first, then copy it
        console.log(`Would download and copy: ${emote.imageUrl}`);
      }
      
      onEmoteClick(emote);
    } catch (error) {
      console.error('Failed to copy emote:', error);
    } finally {
      setIsLoading(null);
    }
  };

  // Determine grid columns based on size
  const gridCols = {
    small: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10',
    medium: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8',
    large: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
  }[gridSize];

  return (
    <div className={`grid ${gridCols} gap-4 p-4`}>
      {emotes.map((emote) => (
        <div
          key={emote.id}
          className="relative cursor-pointer group"
          onMouseEnter={() => setHoveredEmote(emote.id)}
          onMouseLeave={() => setHoveredEmote(null)}
          onClick={() => handleEmoteClick(emote)}
        >
          <div className="aspect-square overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-center p-2 transition-all hover:shadow-md hover:border-blue-500 dark:hover:border-blue-400">
            <img
              src={emote.imageUrl}
              alt={emote.name}
              className="max-h-full max-w-full object-contain"
              style={{ 
                animation: hoveredEmote === emote.id && emote.isAnimated ? 'play 1s linear infinite' : 'none' 
              }}
            />
          </div>
          <div className="mt-1 text-center text-sm text-gray-700 dark:text-gray-300 truncate">
            {emote.name}
          </div>
          <div className="absolute inset-0 bg-blue-500 bg-opacity-20 rounded-lg opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-md">
              {isLoading === emote.id ? 'Copying...' : 'Click to copy'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
} 