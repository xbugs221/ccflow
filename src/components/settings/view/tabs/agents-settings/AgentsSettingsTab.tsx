// PURPOSE: Render provider-specific agent account and MCP settings.
import { useMemo, useState } from 'react';
import type { AgentCategory, AgentProvider } from '../../../types/types';
import AgentCategoryContentSection from './sections/AgentCategoryContentSection';
import AgentCategoryTabsSection from './sections/AgentCategoryTabsSection';
import AgentSelectorSection from './sections/AgentSelectorSection';
import type { AgentContext, AgentsSettingsTabProps } from './types';

/**
 * Keep agent/provider category navigation isolated from each provider detail panel.
 */
export default function AgentsSettingsTab({
  usageEnabled = true,
  codexAuthStatus,
  opencodeAuthStatus,
  onCodexLogin,
  onOpencodeLogin,
  codexMcpServers,
  deleteError,
  onOpenCodexMcpForm,
  onDeleteCodexMcpServer,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('codex');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');

  const agentContextById = useMemo<Record<AgentProvider, AgentContext>>(() => ({
    codex: {
      authStatus: codexAuthStatus,
      onLogin: onCodexLogin,
    },
    opencode: {
      authStatus: opencodeAuthStatus,
      onLogin: onOpencodeLogin,
    },
  }), [
    codexAuthStatus,
    opencodeAuthStatus,
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
          <AgentCategoryTabsSection
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />

          <AgentCategoryContentSection
            usageEnabled={usageEnabled}
            selectedAgent={selectedAgent}
            selectedCategory={selectedCategory}
            agentContextById={agentContextById}
            codexMcpServers={codexMcpServers}
            deleteError={deleteError}
            onOpenCodexMcpForm={onOpenCodexMcpForm}
            onDeleteCodexMcpServer={onDeleteCodexMcpServer}
          />
        </div>
      </div>
    </div>
  );
}
