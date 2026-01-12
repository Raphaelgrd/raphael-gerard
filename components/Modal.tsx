
import React, { useState } from 'react';
import { ItemType, FileSystemItem } from '../types';
import { enhanceNote } from '../services/gemini';

interface ModalProps {
  type: ItemType | 'delete' | 'view';
  onClose: () => void;
  onSubmit?: (type: ItemType, name: string, content?: string) => void;
  onDelete?: () => void;
  item?: FileSystemItem | null;
}

const Modal: React.FC<ModalProps> = ({ type, onClose, onSubmit, onDelete, item }) => {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<ItemType>(type === 'delete' || type === 'view' ? 'note' : type);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit) {
      onSubmit(activeTab, name, content);
      onClose();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setName(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        setContent(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEnhance = async () => {
    setSubmitting(true);
    const enhanced = await enhanceNote(content);
    setContent(enhanced);
    setSubmitting(false);
  };

  if (type === 'delete') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
        <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Delete Item?</h2>
          <p className="text-slate-500 mb-6">Are you sure you want to delete <span className="font-semibold">"{item?.name}"</span>? This action cannot be undone.</p>
          <div className="flex space-x-3">
            <button onClick={onClose} className="flex-1 py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-xl transition-all">Cancel</button>
            <button onClick={onDelete} className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-all shadow-md shadow-red-100">Delete</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
        {item ? (
          // View Mode
          <div className="p-6">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">{item.name}</h2>
                <p className="text-sm text-slate-400 mt-1 uppercase tracking-wide font-medium">{item.type}</p>
              </div>
              <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 min-h-[150px] max-h-[400px] overflow-y-auto">
              {item.type === 'link' ? (
                <a href={item.content} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline break-all flex items-center space-x-2">
                  <span>{item.content}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                </a>
              ) : item.type === 'file' ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <svg className="w-16 h-16 text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                  <p className="text-slate-500 font-medium">Binary Content</p>
                  <button onClick={() => {
                    const link = document.createElement('a');
                    link.href = item.content || '';
                    link.download = item.name;
                    link.click();
                  }} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">Download File</button>
                </div>
              ) : (
                <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{item.content}</p>
              )}
            </div>
          </div>
        ) : (
          // Create Mode
          <>
            <div className="flex border-b border-slate-100">
              {(['folder', 'note', 'link', 'file'] as ItemType[]).map(t => (
                <button
                  key={t}
                  onClick={() => { setActiveTab(t); setName(''); setContent(''); }}
                  className={`flex-1 py-4 text-sm font-bold capitalize transition-all border-b-2 ${
                    activeTab === t ? 'text-indigo-600 border-indigo-600' : 'text-slate-400 border-transparent hover:text-slate-600'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {activeTab === 'file' ? 'File Name' : 'Name'}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                  placeholder={`My Awesome ${activeTab}`}
                />
              </div>

              {activeTab === 'note' && (
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-sm font-medium text-slate-700">Content</label>
                    <button 
                      type="button" 
                      onClick={handleEnhance}
                      disabled={submitting || !content}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center space-x-1 disabled:opacity-50"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span>{submitting ? 'Enhancing...' : 'AI Enhance'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 transition-all outline-none resize-none"
                    placeholder="Write something brilliant..."
                  />
                </div>
              )}

              {activeTab === 'link' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">URL</label>
                  <input
                    type="url"
                    required
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                    placeholder="https://example.com"
                  />
                </div>
              )}

              {activeTab === 'file' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Choose File</label>
                  <input
                    type="file"
                    onChange={handleFileUpload}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                  />
                </div>
              )}

              <div className="flex space-x-3 pt-4">
                <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-xl transition-all">Cancel</button>
                <button type="submit" className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-indigo-100">Create {activeTab}</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default Modal;
