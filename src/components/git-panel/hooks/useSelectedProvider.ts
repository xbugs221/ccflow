import { useEffect, useState } from 'react';
import type { SessionProvider } from '../../../types/app';

function normalizeProvider(value: string | null): SessionProvider {
  return value === 'codex' ? 'codex' : 'claude';
}

export function useSelectedProvider() {
  const [provider, setProvider] = useState(() => {
    return normalizeProvider(localStorage.getItem('selected-provider'));
  });

  useEffect(() => {
    // Keep provider in sync when another tab changes the selected provider.
    const handleStorageChange = () => {
      const nextProvider = normalizeProvider(localStorage.getItem('selected-provider'));
      setProvider(nextProvider);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return provider;
}
