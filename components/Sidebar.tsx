
import React from 'react';
import { FileSystemItem } from '../types';

interface SidebarProps {
  items: FileSystemItem[];
  currentFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  userName: string;
  onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ items, currentFolderId, onSelectFolder, userName, onLogout }) => {
  const rootFolders = items.filter(i => i.type === 'folder' && i.parentId === null);

  const FolderItem: React.FC<{ folder: FileSystemItem, depth: number }> = ({ folder, depth }) => {
    const children = items.filter(i => i.type === 'folder' && i.parentId === folder.id);
    const isActive = currentFolderId === folder.id;

    return (
      <div className="w-full">
        <button
          onClick={() => onSelectFolder(folder.id)}
          className={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
          }`}
          style={{ paddingLeft: `${depth * 1.25 + 0.75}rem` }}
        >
          <svg className={`w-4 h-4 ${isActive ? 'text-indigo-500' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="truncate">{folder.name}</span>
        </button>
        {children.map(child => (
          <FolderItem key={child.id} folder={child} depth={depth + 1} />
        ))}
      </div>
    );
  };

  return (
    <aside className="w-64 border-r border-slate-100 flex flex-col bg-slate-50 shrink-0 hidden md:flex">
      <div className="p-6">
        <div className="flex items-center space-x-2 mb-8">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">O</div>
          <h2 className="text-xl font-bold text-slate-900">OmniVault</h2>
        </div>

        <div className="space-y-1">
          <button
            onClick={() => onSelectFolder(null)}
            className={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              currentFolderId === null ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span>Home</span>
          </button>

          <div className="pt-4 pb-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">Folders</p>
            <div className="space-y-1">
              {rootFolders.map(folder => (
                <FolderItem key={folder.id} folder={folder} depth={0} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto p-4 border-t border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-medium shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-slate-900 truncate">{userName}</p>
              <button onClick={onLogout} className="text-xs text-indigo-600 hover:text-indigo-700">Sign out</button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
