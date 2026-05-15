// PURPOSE: Render provider-specific agent account and connection settings.
import { useMemo, useState } from 'react';
import type { AgentProvider } from '../../../types/types';
import AgentCategoryContentSection from './sections/AgentCategoryContentSection';
import AgentSelectorSection from './sections/AgentSelectorSection';
import type { AgentContext, AgentsSettingsTabProps } from './types';

/**
 * Keep agent/provider category navigation isolated from each provider detail panel.
 */
export default function AgentsSettingsTab({
  usageEnabled = true,
  codexAuthStatus,
  opencodeAuthStatus,
  piAuthStatus,
  onCodexLogin,
  onOpencodeLogin,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('codex');

  const agentContextById = useMemo<Record<AgentProvider, AgentContext>>(() => ({
    codex: {
      authStatus: codexAuthStatus,
      onLogin: onCodexLogin,
    },
    opencode: {
      authStatus: opencodeAuthStatus,
      onLogin: onOpencodeLogin,
    },
    pi: {
      authStatus: piAuthStatus,
      onLogin: () => {},
    },
  }), [
    codexAuthStatus,
    opencodeAuthStatus,
    piAuthStatus,
    onCodexLogin,
    onOpencodeLogin,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row h-full min-h-[400px] md:min-h-[500px]">
        <AgentSelectorSection
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          agentContextById={agentContextById}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <AgentCategoryContentSection
            usageEnabled={usageEnabled}
            selectedAgent={selectedAgent}
            agentContextById={agentContextById}
          />
        </div>
      </div>
    </div>
  );
}
