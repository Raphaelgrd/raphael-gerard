
import React from 'react';
import { FileSystemItem } from '../types';

interface BreadcrumbsProps {
  items: FileSystemItem[];
  currentFolderId: string | null;
  onNavigate: (id: string | null) => void;
}

const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, currentFolderId, onNavigate }) => {
  const getPath = (id: string | null): FileSystemItem[] => {
    if (!id) return [];
    const item = items.find(i => i.id === id);
    if (!item) return [];
    return [...getPath(item.parentId), item];
  };

  const path = getPath(currentFolderId);

  return (
    <nav className="flex items-center space-x-2 text-sm text-slate-400 overflow-hidden">
      <button 
        onClick={() => onNavigate(null)}
        className={`hover:text-indigo-600 transition-colors shrink-0 ${!currentFolderId ? 'font-bold text-slate-900' : ''}`}
      >
        Home
      </button>
      {path.map((item, index) => (
        <React.Fragment key={item.id}>
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
          <button 
            onClick={() => onNavigate(item.id)}
            className={`hover:text-indigo-600 transition-colors truncate max-w-[150px] ${index === path.length - 1 ? 'font-bold text-slate-900' : ''}`}
          >
            {item.name}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
};

export default Breadcrumbs;
