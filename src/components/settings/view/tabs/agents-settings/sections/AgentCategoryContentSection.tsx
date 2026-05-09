import AccountContent from './content/AccountContent';
import McpServersContent from './content/McpServersContent';
import type { AgentCategoryContentSectionProps } from '../types';

export default function AgentCategoryContentSection({
  usageEnabled = true,
  selectedAgent,
  selectedCategory,
  agentContextById,
  codexMcpServers,
  deleteError,
  onOpenCodexMcpForm,
  onDeleteCodexMcpServer,
}: AgentCategoryContentSectionProps) {
  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      {selectedCategory === 'account' && (
        <AccountContent
          agent={selectedAgent}
          authStatus={agentContextById[selectedAgent].authStatus}
          onLogin={agentContextById[selectedAgent].onLogin}
          usageEnabled={usageEnabled}
        />
      )}

      {selectedCategory === 'mcp' && selectedAgent === 'codex' && (
        <McpServersContent
          agent="codex"
          servers={codexMcpServers}
          onAdd={() => onOpenCodexMcpForm()}
          onEdit={(server) => onOpenCodexMcpForm(server)}
          onDelete={(serverId) => onDeleteCodexMcpServer(serverId)}
          deleteError={deleteError}
        />
      )}
    </div>
  );
}
