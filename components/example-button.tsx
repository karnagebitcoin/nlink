'use client';

interface ExampleButtonProps {
  label: string;
  onClick: () => void;
}

export default function ExampleButton({ label, onClick }: ExampleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors"
    >
      {label}
    </button>
  );
}
