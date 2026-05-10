import AccountContent from './content/AccountContent';
import type { AgentCategoryContentSectionProps } from '../types';

export default function AgentCategoryContentSection({
  usageEnabled = true,
  selectedAgent,
  agentContextById,
}: AgentCategoryContentSectionProps) {
  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      <AccountContent
        agent={selectedAgent}
        authStatus={agentContextById[selectedAgent].authStatus}
        onLogin={agentContextById[selectedAgent].onLogin}
        usageEnabled={usageEnabled}
      />
    </div>
  );
}
