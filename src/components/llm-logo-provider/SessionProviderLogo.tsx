import type { SessionProvider } from '../../types/app';
import ClaudeLogo from './ClaudeLogo';
import ChatGptLogo from './ChatGptLogo';
import KimiLogo from './KimiLogo';

type SessionProviderLogoProps = {
  provider?: SessionProvider | string | null;
  model?: string | null;
  className?: string;
};

export default function SessionProviderLogo({
  provider = 'claude',
  model = null,
  className = 'w-5 h-5',
}: SessionProviderLogoProps) {
  if (provider === 'codex') {
    return <ChatGptLogo className={className} />;
  }

  const modelLabel = (model || '').toLowerCase();
  if (modelLabel.includes('kimi')) {
    return <KimiLogo className={className} />;
  }

  return <ClaudeLogo className={className} />;
}
