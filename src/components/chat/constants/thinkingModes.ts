import { Brain, Zap, Sparkles, Atom } from 'lucide-react';

export const thinkingModes = [
  {
    id: 'disabled',
    name: 'Disabled',
    description: 'No extended thinking',
    icon: null,
    color: 'text-gray-600'
  },
  {
    id: 'low',
    name: 'Low',
    description: 'Minimal thinking, fastest responses',
    icon: Brain,
    color: 'text-blue-600'
  },
  {
    id: 'medium',
    name: 'Medium',
    description: 'Moderate thinking for everyday tasks',
    icon: Zap,
    color: 'text-purple-600'
  },
  {
    id: 'high',
    name: 'High',
    description: 'Deep reasoning for complex problems',
    icon: Sparkles,
    color: 'text-indigo-600'
  }
];
