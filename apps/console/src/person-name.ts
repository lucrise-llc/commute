import { useState } from 'react';

const STORAGE_KEY = 'commute.personName';

// The console has no sign-in. A person types their name once, and the browser keeps it.
export function usePersonName(): [string, (name: string) => void] {
  const [name, setName] = useState(readName);
  const save = (next: string): void => {
    setName(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The name stays for this page view when the browser blocks storage.
    }
  };
  return [name, save];
}

function readName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}
