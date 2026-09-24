import { useEffect, useRef, useState } from 'react';

/**
 * Bumps whenever another window writes to `localStorage`.
 *
 * The `storage` event only fires in *other* documents, which is exactly the
 * split the desktop windows need: settings and chat own the writes, the pet
 * window owns the rendering and must pick the change up without a reload.
 */
export function useStorageRevision(matches: (key: string | null) => boolean): number {
  const [revision, setRevision] = useState(0);
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (matchesRef.current(event.key)) setRevision((current) => current + 1);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return revision;
}
