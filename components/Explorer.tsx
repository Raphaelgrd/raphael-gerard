
import React from 'react';
import { FileSystemItem } from '../types';

interface ExplorerProps {
  items: FileSystemItem[];
  onOpenFolder: (id: string) => void;
  onSelectItem: (item: FileSystemItem) => void;
  onDeleteItem: (id: string) => void;
}

const Explorer: React.FC<ExplorerProps> = ({ items, onOpenFolder, onSelectItem, onDeleteItem }) => {
  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400">
        <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-4">
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </div>
        <p className="text-lg font-medium">This folder is empty</p>
        <p className="text-sm">Add notes, files, or links to get started.</p>
      </div>
    );
  }

  const getIcon = (item: FileSystemItem) => {
    switch (item.type) {
      case 'folder':
        return (
          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
        );
      case 'note':
        return (
          <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        );
      case 'link':
        return (
          <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
        );
      case 'file':
        return (
          <div className="w-10 h-10 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
        );
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {items.map(item => (
        <div 
          key={item.id}
          className="group p-4 bg-white border border-slate-100 rounded-2xl hover:shadow-lg hover:shadow-slate-100 hover:border-indigo-100 transition-all cursor-pointer relative"
          onClick={() => item.type === 'folder' ? onOpenFolder(item.id) : onSelectItem(item)}
        >
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={(e) => { e.stopPropagation(); onDeleteItem(item.id); }}
              className="p-1 text-slate-400 hover:text-red-500 rounded"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
          {getIcon(item)}
          <h3 className="text-sm font-semibold text-slate-900 truncate pr-4">{item.name}</h3>
          <p className="text-xs text-slate-400 mt-1 uppercase font-medium tracking-wide">
            {item.type} • {new Date(item.createdAt).toLocaleDateString()}
          </p>
        </div>
      ))}
    </div>
  );
};

export default Explorer;
