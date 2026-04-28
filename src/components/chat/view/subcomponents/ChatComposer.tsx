/**
 * Chat composer presentation component.
 * Renders message input, attachment controls, command/file menus, and action buttons.
 * Permission approval UI is intentionally disabled because YOLO mode auto-approves Claude tools.
 */
import { Command, FileUp, FolderUp, Paperclip } from 'lucide-react';
import CommandMenu from './CommandMenu';
import MicButton from '../../../mic-button/view/MicButton';
import ImageAttachment from './ImageAttachment';
import SessionModelControls from './SessionModelControls';
import { useTranslation } from 'react-i18next';
import { useWebSocket } from '../../../../contexts/WebSocketContext';
import { useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SetStateAction,
  TouchEvent,
} from 'react';
import type { Provider } from '../../types/types';

interface MentionableFile {
  name: string;
  path: string;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  claudeStatus: { text: string; tokens: number; can_interrupt: boolean } | null;
  isLoading: boolean;
  isComposerSubmitting: boolean;
  onAbortSession: () => void;
  provider: Provider | string;
  thinkingMode: string;
  setThinkingMode: (mode: string) => void;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  claudeModelOptions: { value: string; label: string }[];
  codexModel: string;
  setCodexModel: (model: string) => void;
  codexModelOptions: { value: string; label: string }[];
  codexReasoningEffort: string;
  setCodexReasoningEffort: (effort: string) => void;
  codexReasoningOptions: { value: string; label: string; description?: string }[];
  onToggleCommandMenu: () => void;
  onToggleFileMenu: () => void;
  hasMessages: boolean;
  isFollowingLatest: boolean;
  onToggleFollowLatest: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  attachedUploads: File[];
  onRemoveAttachment: (index: number) => void;
  uploadingAttachments: Map<string, number>;
  attachmentErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openAttachmentPicker: () => void;
  onAttachmentSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;

  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  onTranscript: (text: string) => void;
}

/**
 * Render chat composer UI and wire user interactions to callbacks from state hooks.
 */
export default function ChatComposer({
  claudeStatus,
  isLoading,
  isComposerSubmitting,
  onAbortSession,
  provider,
  thinkingMode,
  setThinkingMode,
  claudeModel,
  setClaudeModel,
  claudeModelOptions,
  codexModel,
  setCodexModel,
  codexModelOptions,
  codexReasoningEffort,
  setCodexReasoningEffort,
  codexReasoningOptions,
  onToggleCommandMenu,
  onToggleFileMenu,
  hasMessages,
  isFollowingLatest,
  onToggleFollowLatest,
  onSubmit,
  isDragActive,
  attachedUploads,
  onRemoveAttachment,
  uploadingAttachments,
  attachmentErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openAttachmentPicker,
  onAttachmentSelection,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  onTranscript,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const { isConnected } = useWebSocket();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const trimmedInput = input.trim();
  const canSubmit = !isComposerSubmitting && Boolean(trimmedInput) && isConnected;
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const textareaRect = textareaRef.current?.getBoundingClientRect();

  // Guard against click-through: when isLoading transitions from false→true
  // (send button becomes stop button in the same position), the browser's
  // mouseup/click from the send tap can land on the newly-rendered stop button.
  // Block stop-button clicks for a short window after the transition.
  const abortGuardRef = useRef(false);
  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (isLoading && !prevIsLoadingRef.current) {
      abortGuardRef.current = true;
      const timer = window.setTimeout(() => {
        abortGuardRef.current = false;
      }, 400);
      prevIsLoadingRef.current = isLoading;
      return () => window.clearTimeout(timer);
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading]);

  /**
   * Close the upload menu when the user clicks outside the picker.
   */
  useEffect(() => {
    if (!isUploadMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (uploadMenuRef.current && !uploadMenuRef.current.contains(event.target)) {
        setIsUploadMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isUploadMenuOpen]);

  const guardedAbort = () => {
    if (abortGuardRef.current) {
      return;
    }
    onAbortSession();
  };

  return (
    <div className="p-2 sm:p-4 md:p-4 flex-shrink-0 pb-2 sm:pb-4 md:pb-6">
      <form onSubmit={onSubmit as (event: FormEvent<HTMLFormElement>) => void} className="relative max-w-4xl mx-auto">
        {isDragActive && (
          <div className="absolute inset-0 bg-primary/15 border-2 border-dashed border-primary/50 rounded-2xl flex items-center justify-center z-50">
            <div className="bg-card rounded-xl p-4 shadow-lg border border-border/30">
              <svg className="w-8 h-8 text-primary mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-sm font-medium">Drop files or folders here</p>
            </div>
          </div>
        )}

        {attachedUploads.length > 0 && (
          <div className="mb-2 p-2 bg-muted/40 rounded-xl">
            <div className="flex flex-wrap gap-2">
              {attachedUploads.map((file, index) => (
                <ImageAttachment
                  key={`${file.webkitRelativePath || file.name}:${file.size}:${index}`}
                  file={file}
                  onRemove={() => onRemoveAttachment(index)}
                  uploadProgress={uploadingAttachments.get(file.webkitRelativePath || file.name)}
                  error={attachmentErrors.get(file.webkitRelativePath || file.name)}
                />
              ))}
            </div>
          </div>
        )}

        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-lg max-h-48 overflow-y-auto z-50">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`px-4 py-3 cursor-pointer border-b border-border/30 last:border-b-0 touch-manipulation ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'hover:bg-accent/50 text-foreground'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="font-medium text-sm">{file.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <div
          {...getRootProps()}
          className={`relative bg-card/80 backdrop-blur-sm rounded-2xl shadow-sm border border-border/50 focus-within:shadow-md focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/15 transition-all duration-200 overflow-visible ${
            isTextareaExpanded ? 'chat-input-expanded' : ''
          }`}
        >
          <input {...getInputProps()} />
          <input
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onAttachmentSelection}
          />
          <div className="relative z-10 px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleCommandMenu}
                  className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/90 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  title={t('input.showAllCommands')}
                >
                  <Command className="h-4 w-4" strokeWidth={2} />
                </button>

                <button
                  type="button"
                  onClick={onToggleFileMenu}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/90 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  title={t('input.insertProjectFile', { defaultValue: 'Insert project file' })}
                >
                  <span className="text-sm font-semibold">@</span>
                </button>

                <div ref={uploadMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setIsUploadMenuOpen((current) => !current)}
                    disabled={isComposerSubmitting}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/90 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    title={t('input.attachFiles', { defaultValue: 'Upload files or folders' })}
                  >
                    <Paperclip className="h-4 w-4" strokeWidth={2} />
                  </button>

                  {isUploadMenuOpen && (
                    <div className="absolute bottom-full left-0 z-50 mb-2 min-w-36 rounded-xl border border-border/50 bg-card/95 p-1.5 shadow-lg backdrop-blur-md">
                      <button
                        type="button"
                        onClick={() => {
                          openAttachmentPicker();
                          setIsUploadMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/60"
                      >
                        <FileUp className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
                        <span>{t('input.attachFiles')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          folderInputRef.current?.click();
                          setIsUploadMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/60"
                      >
                        <FolderUp className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
                        <span>{t('input.attachFolder')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {hasMessages && (
                  <button
                    type="button"
                    aria-pressed={isFollowingLatest}
                    data-testid="chat-follow-latest"
                    onClick={onToggleFollowLatest}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                      isFollowingLatest
                        ? 'border-emerald-500/80 bg-emerald-500 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.18)]'
                        : 'border-border/60 bg-background/90 text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    }`}
                    title={isFollowingLatest ? '自动跟随到底部并持续刷新' : '点击后自动跟随到底部并持续刷新'}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </button>
                )}

                <SessionModelControls
                  provider={provider}
                  thinkingMode={thinkingMode}
                  setThinkingMode={setThinkingMode}
                  claudeModel={claudeModel}
                  setClaudeModel={setClaudeModel}
                  claudeModelOptions={claudeModelOptions}
                  codexModel={codexModel}
                  setCodexModel={setCodexModel}
                  codexModelOptions={codexModelOptions}
                  codexReasoningEffort={codexReasoningEffort}
                  setCodexReasoningEffort={setCodexReasoningEffort}
                  codexReasoningOptions={codexReasoningOptions}
                />

                <div className="ml-2 flex items-center">
                  {isLoading ? (
                    <>
                      <button
                        type="submit"
                        disabled
                        aria-hidden="true"
                        tabIndex={-1}
                        className="sr-only pointer-events-none"
                      />
                      <button
                        type="button"
                        onClick={guardedAbort}
                        onMouseDown={(event) => event.preventDefault()}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90 focus:outline-none focus:ring-2 focus:ring-destructive/30"
                        title={t('input.stop')}
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="5" y="5" width="14" height="14" rx="2" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        if (!isComposerSubmitting) {
                          onSubmit(event);
                        }
                      }}
                      onTouchStart={(event) => {
                        event.preventDefault();
                        if (!isComposerSubmitting) {
                          onSubmit(event);
                        }
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/30"
                      title={!isConnected ? 'WebSocket disconnected' : undefined}
                    >
                      <svg className="h-4 w-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-2">
              <div className="relative min-w-0">
                <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div className="chat-input-placeholder block w-full text-transparent text-base leading-6 whitespace-pre-wrap break-words">
                    {renderInputWithMentions(input)}
                  </div>
                </div>

                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={onInputChange}
                  onClick={onTextareaClick}
                  onKeyDown={onTextareaKeyDown}
                  onPaste={onTextareaPaste}
                  onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
                  onFocus={() => onInputFocusChange?.(true)}
                  onBlur={() => onInputFocusChange?.(false)}
                  onInput={onTextareaInput}
                  placeholder={placeholder}
                  disabled={isComposerSubmitting}
                  className="chat-input-placeholder block w-full bg-transparent focus:outline-none text-foreground placeholder-muted-foreground/50 disabled:opacity-50 resize-none min-h-[48px] sm:min-h-[64px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-base leading-6 transition-all duration-200"
                  style={{ height: '64px' }}
                />
              </div>

              <div className="mt-1 flex items-center justify-between gap-3">
                {!isConnected && (
                  <div className="text-xs text-destructive/70 pointer-events-none flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive/70 animate-pulse" />
                    <span className="hidden sm:inline">Disconnected</span>
                  </div>
                )}

                <div
                  className={`text-xs text-muted-foreground/50 pointer-events-none hidden sm:block transition-opacity duration-200 ${
                    input.trim() || !isConnected ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  {sendByCtrlEnter ? t('input.hintText.ctrlEnter') : t('input.hintText.enter')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
