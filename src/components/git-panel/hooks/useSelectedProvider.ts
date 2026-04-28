import { useEffect, useState } from 'react';

function normalizeProvider(value: string | null): 'claude' | 'codex' {
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
