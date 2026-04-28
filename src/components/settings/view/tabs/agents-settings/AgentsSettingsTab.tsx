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
  claudeAuthStatus,
  codexAuthStatus,
  onClaudeLogin,
  onCodexLogin,
  mcpServers,
  codexMcpServers,
  mcpTestResults,
  mcpServerTools,
  mcpToolsLoading,
  deleteError,
  onOpenMcpForm,
  onDeleteMcpServer,
  onTestMcpServer,
  onDiscoverMcpTools,
  onOpenCodexMcpForm,
  onDeleteCodexMcpServer,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('claude');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');

  const agentContextById = useMemo<Record<AgentProvider, AgentContext>>(() => ({
    claude: {
      authStatus: claudeAuthStatus,
      onLogin: onClaudeLogin,
    },
    codex: {
      authStatus: codexAuthStatus,
      onLogin: onCodexLogin,
    },
  }), [
    claudeAuthStatus,
    codexAuthStatus,
    onClaudeLogin,
    onCodexLogin,
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
            mcpServers={mcpServers}
            codexMcpServers={codexMcpServers}
            mcpTestResults={mcpTestResults}
            mcpServerTools={mcpServerTools}
            mcpToolsLoading={mcpToolsLoading}
            deleteError={deleteError}
            onOpenMcpForm={onOpenMcpForm}
            onDeleteMcpServer={onDeleteMcpServer}
            onTestMcpServer={onTestMcpServer}
            onDiscoverMcpTools={onDiscoverMcpTools}
            onOpenCodexMcpForm={onOpenCodexMcpForm}
            onDeleteCodexMcpServer={onDeleteCodexMcpServer}
          />
        </div>
      </div>
    </div>
  );
}
