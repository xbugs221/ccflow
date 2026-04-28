import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import Fuse from 'fuse.js';
import { authenticatedFetch } from '../../../utils/api';
import { safeLocalStorage } from '../utils/chatStorage';
import type { Project } from '../../../types/app';

const GLOBAL_COMMAND_HISTORY_KEY = 'command_history_global_aliases';

export interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface UseSlashCommandsOptions {
  selectedProject: Project | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onExecuteCommand: (
    command: SlashCommand,
    rawInput?: string,
    appendBaseInput?: string,
  ) => void | Promise<void>;
}

const getCommandHistoryKey = (projectName?: string | null) =>
  projectName ? `command_history_${projectName}` : GLOBAL_COMMAND_HISTORY_KEY;

const readCommandHistory = (projectName?: string | null): Record<string, number> => {
  const history = safeLocalStorage.getItem(getCommandHistoryKey(projectName));
  if (!history) {
    return {};
  }

  try {
    return JSON.parse(history);
  } catch (error) {
    console.error('Error parsing command history:', error);
    return {};
  }
};

const saveCommandHistory = (projectName: string | null | undefined, history: Record<string, number>) => {
  safeLocalStorage.setItem(getCommandHistoryKey(projectName), JSON.stringify(history));
};

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  Boolean(value) && typeof (value as Promise<unknown>).then === 'function';

export function useSlashCommands({
  selectedProject,
  input,
  textareaRef,
  onExecuteCommand,
}: UseSlashCommandsOptions) {
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);

  const resetCommandMenuState = useCallback(() => {
    setShowCommandMenu(false);
    setSelectedCommandIndex(-1);
  }, []);

  useEffect(() => {
    const fetchCommands = async () => {
      try {
        const response = await authenticatedFetch('/api/commands/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch commands');
        }

        const data = await response.json();
        const allCommands = ((data.commands || []) as SlashCommand[]).map((command) => ({
          ...command,
          type: 'alias',
        }));

        setSlashCommands(allCommands);
      } catch (error) {
        console.error('Error fetching slash commands:', error);
        setSlashCommands([]);
      }
    };

    fetchCommands();
  }, [selectedProject]);

  useEffect(() => {
    if (!showCommandMenu) {
      setSelectedCommandIndex(-1);
    }
  }, [showCommandMenu]);

  const fuse = useMemo(() => {
    if (!slashCommands.length) {
      return null;
    }

    return new Fuse(slashCommands, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'description', weight: 1 },
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 1,
    });
  }, [slashCommands]);

  useEffect(() => {
    if (!commandQuery) {
      setFilteredCommands(slashCommands);
      return;
    }

    if (!fuse) {
      setFilteredCommands([]);
      return;
    }

    const results = fuse.search(commandQuery);
    setFilteredCommands(results.map((result) => result.item));
  }, [commandQuery, slashCommands, fuse]);

  const frequentCommands = useMemo(() => [], []);

  const trackCommandUsage = useCallback(
    (command: SlashCommand) => {
      const parsedHistory = readCommandHistory(selectedProject?.name);
      parsedHistory[command.name] = (parsedHistory[command.name] || 0) + 1;
      saveCommandHistory(selectedProject?.name, parsedHistory);
    },
    [selectedProject],
  );

  const selectCommandFromKeyboard = useCallback(
    (command: SlashCommand) => {
      const appendBaseInput = input.trimEnd();
      resetCommandMenuState();

      const executionResult = onExecuteCommand(command, command.name, appendBaseInput);
      if (isPromiseLike(executionResult)) {
        executionResult.catch(() => {
          // Keep behavior silent; execution errors are handled by caller.
        });
      }
    },
    [input, resetCommandMenuState, onExecuteCommand],
  );

  const handleCommandSelect = useCallback(
    (command: SlashCommand | null, index: number, isHover: boolean) => {
      if (!command) {
        return;
      }

      if (isHover) {
        setSelectedCommandIndex(index);
        return;
      }

      trackCommandUsage(command);
      const appendBaseInput = input.trimEnd();
      const executionResult = onExecuteCommand(command, command.name, appendBaseInput);

      if (isPromiseLike(executionResult)) {
        executionResult.then(() => {
          resetCommandMenuState();
        });
        executionResult.catch(() => {
          // Keep behavior silent; execution errors are handled by caller.
        });
      } else {
        resetCommandMenuState();
      }
    },
    [input, trackCommandUsage, onExecuteCommand, resetCommandMenuState],
  );

  const handleToggleCommandMenu = useCallback(() => {
    const isOpening = !showCommandMenu;
    setShowCommandMenu(isOpening);
    setSelectedCommandIndex(-1);

    if (isOpening) {
      setFilteredCommands(slashCommands);
    }
  }, [showCommandMenu, slashCommands]);

  const handleCommandInputChange = useCallback(
    (newValue: string) => {
      if (!showCommandMenu) {
        return;
      }

      if (!newValue.trim()) {
        resetCommandMenuState();
      }
    },
    [resetCommandMenuState, showCommandMenu],
  );

  const handleCommandMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!showCommandMenu) {
        return false;
      }

      if (!filteredCommands.length) {
        if (event.key === 'Escape') {
          event.preventDefault();
          resetCommandMenuState();
          return true;
        }
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex < filteredCommands.length - 1 ? previousIndex + 1 : 0,
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex > 0 ? previousIndex - 1 : filteredCommands.length - 1,
        );
        return true;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        if (selectedCommandIndex >= 0) {
          selectCommandFromKeyboard(filteredCommands[selectedCommandIndex]);
        } else if (filteredCommands.length > 0) {
          selectCommandFromKeyboard(filteredCommands[0]);
        }
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        resetCommandMenuState();
        return true;
      }

      return false;
    },
    [showCommandMenu, filteredCommands, resetCommandMenuState, selectCommandFromKeyboard, selectedCommandIndex],
  );

  return {
    slashCommands,
    slashCommandsCount: slashCommands.length,
    filteredCommands,
    frequentCommands,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  };
}
