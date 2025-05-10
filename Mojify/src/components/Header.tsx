import { ThemeToggle } from './ThemeToggle';
import { useState } from 'react';

type GridSize = 'small' | 'medium' | 'large';

interface HeaderProps {
  gridSize: GridSize;
  onGridSizeChange: (size: GridSize) => void;
  channelId: string;
  onChannelIdChange: (id: string) => void;
}

export function Header({ 
  gridSize, 
  onGridSizeChange,
  channelId,
  onChannelIdChange
}: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [inputChannelId, setInputChannelId] = useState(channelId);

  const handleChannelIdSubmit = () => {
    onChannelIdChange(inputChannelId);
  };

  return (
    <header className="sticky top-0 z-10 w-full border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-6 h-6 text-blue-500"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Mojify</h1>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Settings"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
          <ThemeToggle />
        </div>
      </div>
      
      {showSettings && (
        <div className="container mx-auto px-4 py-3 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800">
          <div className="flex flex-col space-y-4">
            <h2 className="text-lg font-medium">Settings</h2>
            <div className="flex items-center justify-between">
              <span>Grid Size</span>
              <div className="flex space-x-2">
                <button 
                  className={`px-3 py-1 rounded-md ${gridSize === 'small' ? 'bg-blue-500 text-white' : 'border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                  onClick={() => onGridSizeChange('small')}
                >
                  Small
                </button>
                <button 
                  className={`px-3 py-1 rounded-md ${gridSize === 'medium' ? 'bg-blue-500 text-white' : 'border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                  onClick={() => onGridSizeChange('medium')}
                >
                  Medium
                </button>
                <button 
                  className={`px-3 py-1 rounded-md ${gridSize === 'large' ? 'bg-blue-500 text-white' : 'border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                  onClick={() => onGridSizeChange('large')}
                >
                  Large
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span>7TV Channel</span>
              <div className="flex space-x-2">
                <input 
                  type="text" 
                  value={inputChannelId}
                  onChange={(e) => setInputChannelId(e.target.value)}
                  placeholder="Enter 7TV channel ID" 
                  className="px-3 py-1 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800"
                />
                <button
                  onClick={handleChannelIdSubmit}
                  className="px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
} 