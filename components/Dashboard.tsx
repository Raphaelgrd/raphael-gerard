
import React, { useState, useMemo } from 'react';
import { User, FileSystemItem, ItemType } from '../types';
import Sidebar from './Sidebar';
import Explorer from './Explorer';
import Breadcrumbs from './Breadcrumbs';
import Modal from './Modal';
import { summarizeFolderContent } from '../services/gemini';

interface DashboardProps {
  user: User;
  items: FileSystemItem[];
  setItems: React.Dispatch<React.SetStateAction<FileSystemItem[]>>;
  onLogout: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ user, items, setItems, onLogout }) => {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<ItemType | 'delete'>('folder');
  const [selectedItem, setSelectedItem] = useState<FileSystemItem | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const currentFolderItems = useMemo(() => {
    return items.filter(item => item.parentId === currentFolderId);
  }, [items, currentFolderId]);

  const currentFolder = useMemo(() => {
    return items.find(i => i.id === currentFolderId);
  }, [items, currentFolderId]);

  const handleAddItem = (type: ItemType, name: string, content?: string) => {
    const newItem: FileSystemItem = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      type,
      parentId: currentFolderId,
      content,
      createdAt: Date.now(),
    };
    setItems(prev => [...prev, newItem]);
    setIsModalOpen(false);
  };

  const handleDeleteItem = (id: string) => {
    // Recursive delete for folders
    const getIdsToDelete = (parentId: string): string[] => {
      const children = items.filter(i => i.parentId === parentId);
      let ids = [parentId];
      children.forEach(child => {
        if (child.type === 'folder') {
          ids = [...ids, ...getIdsToDelete(child.id)];
        } else {
          ids.push(child.id);
        }
      });
      return ids;
    };

    const idsToDelete = getIdsToDelete(id);
    setItems(prev => prev.filter(item => !idsToDelete.includes(item.id)));
    setIsModalOpen(false);
    setSelectedItem(null);
  };

  const handleSummarize = async () => {
    if (!currentFolderId && currentFolderItems.length === 0) return;
    setIsSummarizing(true);
    setSummary(null);
    const itemNames = currentFolderItems.map(i => `${i.type.toUpperCase()}: ${i.name}`);
    const res = await summarizeFolderContent(currentFolder?.name || 'Root', itemNames);
    setSummary(res || 'No summary available.');
    setIsSummarizing(false);
  };

  return (
    <div className="flex h-screen bg-white">
      {/* Sidebar - Desktop Only */}
      <Sidebar 
        items={items} 
        onSelectFolder={setCurrentFolderId} 
        currentFolderId={currentFolderId} 
        userName={user.name}
        onLogout={onLogout}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-slate-100 flex items-center justify-between px-6 bg-white shrink-0">
          <div className="flex items-center space-x-4 overflow-hidden">
            <Breadcrumbs 
              items={items} 
              currentFolderId={currentFolderId} 
              onNavigate={setCurrentFolderId} 
            />
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={handleSummarize}
              disabled={isSummarizing || currentFolderItems.length === 0}
              className="px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors flex items-center space-x-2 disabled:opacity-50"
            >
              {isSummarizing ? (
                <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              <span>AI Summary</span>
            </button>
            <button 
              onClick={() => { setModalType('folder'); setIsModalOpen(true); }}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
              title="New Folder"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </button>
            <button 
              onClick={() => { setModalType('note'); setIsModalOpen(true); }}
              className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-colors"
              title="Add Item"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </header>

        {/* Gemini Summary Box */}
        {summary && (
          <div className="mx-6 mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-xl relative">
            <button 
              onClick={() => setSummary(null)}
              className="absolute top-2 right-2 text-indigo-400 hover:text-indigo-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
            <div className="flex items-start space-x-3">
              <div className="p-1 bg-indigo-200 rounded text-indigo-700">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1a1 1 0 112 0v1a1 1 0 11-2 0zM13 16v-1a1 1 0 112 0v1a1 1 0 11-2 0zM6.464 14.95a1 1 0 11-1.414 1.414l-.707-.707a1 1 0 011.414-1.414l.707.707zM14.95 14.95a1 1 0 101.414-1.414l-.707-.707a1 1 0 00-1.414 1.414l.707.707z" /></svg>
              </div>
              <p className="text-sm text-indigo-800 leading-relaxed italic">{summary}</p>
            </div>
          </div>
        )}

        {/* Explorer Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <Explorer 
            items={currentFolderItems} 
            onOpenFolder={setCurrentFolderId}
            onSelectItem={setSelectedItem}
            onDeleteItem={(id) => { setSelectedItem(items.find(i => i.id === id) || null); setModalType('delete'); setIsModalOpen(true); }}
          />
        </div>
      </main>

      {/* Modals */}
      {isModalOpen && (
        <Modal 
          type={modalType} 
          onClose={() => setIsModalOpen(false)} 
          onSubmit={handleAddItem}
          onDelete={() => selectedItem && handleDeleteItem(selectedItem.id)}
          item={selectedItem}
        />
      )}
    </div>
  );
};

export default Dashboard;
