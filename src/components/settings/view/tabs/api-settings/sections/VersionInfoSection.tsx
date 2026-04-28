type VersionInfoSectionProps = {
  currentVersion: string;
};

export default function VersionInfoSection({
  currentVersion,
}: VersionInfoSectionProps) {
  return (
    <div className="pt-6 border-t border-border/50">
      <div className="text-xs italic text-muted-foreground/60">
        v{currentVersion}
      </div>
    </div>
  );
}
