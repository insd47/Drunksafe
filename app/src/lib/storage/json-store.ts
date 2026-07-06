import Storage from 'expo-sqlite/kv-store';

export const jsonStore = {
  getItem(key: string) {
    return Storage.getItem(key);
  },
  setItem(key: string, value: string) {
    return Storage.setItem(key, value);
  },
  removeItem(key: string) {
    return Storage.removeItem(key);
  },
};
