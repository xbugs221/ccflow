const GitBranch = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
type GitRepositoryErrorStateProps = {
  error: string;
  details?: string;
};

export default function GitRepositoryErrorState({ error, details }: GitRepositoryErrorStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground px-6 py-12">
      <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-6">
        <GitBranch className="w-8 h-8 opacity-40" />
      </div>
      <h3 className="text-lg font-medium mb-3 text-center text-foreground">{error}</h3>
      {details && (
        <p className="text-sm text-center leading-relaxed mb-6 max-w-md">{details}</p>
      )}
      <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 max-w-md">
        <p className="text-sm text-primary text-center">
          <strong>Tip:</strong> Run{' '}
          <code className="bg-primary/10 px-2 py-1 rounded-md font-mono text-xs">git init</code>{' '}
          in your project directory to initialize git source control.
        </p>
      </div>
    </div>
  );
}
