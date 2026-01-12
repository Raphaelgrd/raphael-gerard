
import React, { useState, useEffect } from 'react';
import { User, FileSystemItem } from './types';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<FileSystemItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem('omnivault_user');
    const savedItems = localStorage.getItem('omnivault_items');
    
    if (savedUser) setUser(JSON.parse(savedUser));
    if (savedItems) setItems(JSON.parse(savedItems));
    
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem('omnivault_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('omnivault_user');
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem('omnivault_items', JSON.stringify(items));
  }, [items]);

  const handleLogout = () => {
    setUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {!user ? (
        <AuthPage onLogin={setUser} />
      ) : (
        <Dashboard 
          user={user} 
          items={items} 
          setItems={setItems} 
          onLogout={handleLogout} 
        />
      )}
    </div>
  );
};

export default App;
