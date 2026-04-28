/**
 * PURPOSE: Render context-mode single-command inputs with intent and executable content first.
 */
import React from 'react';
import { Check, Copy } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { copyTextToClipboard } from '../../../../../utils/clipboard';
import { useTheme } from '../../../../../contexts/ThemeContext';
import type { ContextCommandPayloadViewModel } from './toolPayloadParsers';

interface ContextCommandContentProps {
  payload: ContextCommandPayloadViewModel;
  variant?: 'default' | 'execute' | 'execute-file' | 'search' | 'shell-command';
}

export interface ContextCodeCardProps {
  title: string;
  language: string;
  code: string;
  output?: string;
  metadata?: Array<{ label: string; value: string }>;
  showLanguage?: boolean;
  wrapCode?: boolean;
  singleLineUntilWrap?: boolean;
}

/**
 * Normalize context-mode language names to Prism language ids.
 */
function normalizeSyntaxLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return 'text';
  }
  if (['shell', 'sh', 'zsh'].includes(normalized)) {
    return 'bash';
  }
  return normalized;
}

/**
 * Render one executable ctx block as title, highlighted code, then folded output.
 */
export const ContextCodeCard: React.FC<ContextCodeCardProps> = ({
  title,
  language,
  code,
  output = '',
  metadata = [],
  showLanguage = true,
  wrapCode = false,
  singleLineUntilWrap = false,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [showControls, setShowControls] = React.useState(false);
  const [outputOpen, setOutputOpen] = React.useState(false);
  const { isDarkMode } = useTheme();
  const displayLanguage = language || 'text';
  const syntaxLanguage = normalizeSyntaxLanguage(displayLanguage);
  const trimmedOutput = output.trim();
  const shouldCollapseToSingleLine = singleLineUntilWrap && !wrapCode;
  const displayedCode = shouldCollapseToSingleLine
    ? code.replace(/\s*\r?\n\s*/g, ' ')
    : code;

  const handleCopy = async () => {
    const didCopy = await copyTextToClipboard(code);
    if (!didCopy) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      data-testid="tool-context-code-card"
      data-single-line={shouldCollapseToSingleLine ? 'true' : 'false'}
      className="group/context-code overflow-hidden rounded border border-gray-200/70 dark:border-gray-700/60"
      onClick={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <div className="relative">
        {trimmedOutput && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOutputOpen((value) => !value);
              setShowControls(true);
            }}
            className="absolute left-1.5 top-1 z-20 inline-flex h-5 w-5 items-center justify-center font-mono text-[13px] leading-none text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            title={outputOpen ? 'Hide output' : 'Show output'}
            aria-label={outputOpen ? 'Hide output' : 'Show output'}
            aria-expanded={outputOpen}
          >
            {outputOpen ? '▾' : '▸'}
          </button>
        )}
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex min-h-6 items-center justify-between gap-2 px-1.5 pt-1 transition-opacity group-hover/context-code:opacity-100 group-focus-within/context-code:opacity-100 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex min-w-0 items-center gap-1 pl-6">
            {title && (
              <span className="pointer-events-none max-w-48 truncate rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900/90 dark:text-gray-300 dark:ring-gray-700">
                {title}
              </span>
            )}
            {metadata.map((item) => (
              <span
                key={`${item.label}-${item.value}`}
                className="pointer-events-none rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-gray-500 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900/90 dark:text-gray-400 dark:ring-gray-700"
              >
                {item.label}: {item.value}
              </span>
            ))}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {showLanguage && (
              <span className="pointer-events-none rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-gray-600 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900/90 dark:text-gray-300 dark:ring-gray-700">
                {displayLanguage}
              </span>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleCopy();
                setShowControls(true);
              }}
              className="pointer-events-auto inline-flex h-5 w-5 items-center justify-center rounded bg-white/90 text-gray-500 shadow-sm ring-1 ring-gray-200 transition-colors hover:text-gray-800 dark:bg-gray-900/90 dark:text-gray-400 dark:ring-gray-700 dark:hover:text-gray-100"
              title="Copy code"
              aria-label="Copy code"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <SyntaxHighlighter
          className={[
            wrapCode ? 'context-code-wrap' : 'context-code-nowrap',
            'context-code-scrollbar-interactive',
            showControls ? 'context-code-scrollbar-active' : '',
          ].filter(Boolean).join(' ')}
          language={syntaxLanguage}
          style={isDarkMode ? oneDark : oneLight}
          customStyle={{
            background: isDarkMode ? '#1e1e1e' : '#ffffff',
            margin: 0,
            borderRadius: 0,
            fontSize: '0.72rem',
            lineHeight: '0.8rem',
            overflowX: shouldCollapseToSingleLine || wrapCode ? 'hidden' : 'auto',
            overflowY: 'hidden',
            padding: '0.4rem 0.75rem 0.4rem 2rem',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              lineHeight: '0.8rem',
              whiteSpace: 'pre',
              wordBreak: 'normal',
            },
          }}
        >
          {displayedCode}
        </SyntaxHighlighter>
      </div>

      {trimmedOutput && (
        <pre
          className={`max-h-80 overflow-auto border-t border-gray-200/70 bg-white px-2.5 py-2 text-[11px] font-mono whitespace-pre-wrap break-words text-gray-700 dark:border-gray-700/60 dark:bg-gray-950/30 dark:text-gray-200 ${
            outputOpen ? 'block' : 'hidden'
          }`}
        >
          {trimmedOutput}
        </pre>
      )}
    </div>
  );
};

/**
 * Keep context-mode inputs focused on the command/code while hiding secondary query noise.
 */
export const ContextCommandContent: React.FC<ContextCommandContentProps> = ({ payload, variant = 'default' }) => {
  const hasIntent = payload.intent.trim().length > 0;
  const hasCode = payload.code.trim().length > 0;
  const hasQueries = payload.queries.length > 0;
  const isExecute = variant === 'execute';
  const isExecuteFile = variant === 'execute-file';
  const isSearch = variant === 'search';
  const isShellCommand = variant === 'shell-command';
  const isShellLanguage = ['shell', 'sh', 'zsh', 'bash'].includes(payload.language.trim().toLowerCase());
  const visibleMetadata = isExecute || isExecuteFile || isShellCommand
    ? []
    : payload.metadata;
  const hasMetadata = visibleMetadata.length > 0 || payload.language;
  const fallback = payload.fallback.trim();
  const title = isExecute || isExecuteFile
    ? ''
    : isShellCommand
      ? ''
      : hasIntent
        ? payload.intent
        : 'Context command';
  const code = hasCode ? payload.code : fallback;

  if (!hasIntent && !code && !hasQueries && !hasMetadata) {
    return null;
  }

  if (isSearch) {
    return (
      <div data-testid="tool-context-command-content" className="space-y-2">
        {payload.queries.map((query, index) => (
          <div
            key={`${query}-${index}`}
            className="rounded border border-gray-200/70 px-2.5 py-2 dark:border-gray-700/60"
          >
            <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Search</div>
            <div className="mt-1 text-xs font-mono whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100">
              {query}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div data-testid="tool-context-command-content" className="space-y-3">
      {code && (
        <ContextCodeCard
          title={title}
          language={payload.language || 'text'}
          code={code}
          output={payload.output}
          metadata={visibleMetadata}
          showLanguage={!(isShellCommand || (isExecute && isShellLanguage))}
          singleLineUntilWrap={isShellCommand || isExecute || isExecuteFile}
        />
      )}

      {hasQueries && (
        <details className="rounded border border-gray-200/70 px-2.5 py-2 dark:border-gray-700/60">
          <summary className="cursor-pointer text-[11px] font-medium text-gray-600 dark:text-gray-300">
            查询 {payload.queries.length} 条
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {payload.queries.map((query, index) => (
              <span
                key={`${query}-${index}`}
                className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                {query}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};
