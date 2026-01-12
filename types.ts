
export type ItemType = 'folder' | 'note' | 'link' | 'file';

export interface FileSystemItem {
  id: string;
  name: string;
  type: ItemType;
  parentId: string | null;
  content?: string; // For notes (text), links (url), or files (base64/metadata)
  createdAt: number;
  mimeType?: string;
  size?: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AppState {
  items: FileSystemItem[];
  currentFolderId: string | null;
  user: User | null;
}
