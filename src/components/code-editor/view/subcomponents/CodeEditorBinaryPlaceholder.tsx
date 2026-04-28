/**
 * PURPOSE: Explain why a non-text file stays out of the text editor while
 * keeping the safe download path obvious.
 */
type CodeEditorBinaryPlaceholderProps = {
  filePath: string;
  message: string;
  detail: string;
};

export default function CodeEditorBinaryPlaceholder({
  filePath,
  message,
  detail,
}: CodeEditorBinaryPlaceholderProps) {
  return (
    <div className="h-full overflow-y-auto bg-muted/30">
      <div className="mx-auto flex h-full max-w-3xl flex-col justify-center px-6 py-8">
        <div className="rounded-lg border border-border bg-background px-5 py-4">
          <p className="text-base font-medium text-foreground">{message}</p>
          <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
          <p className="mt-4 break-all text-xs text-muted-foreground">{filePath}</p>
        </div>
      </div>
    </div>
  );
}
