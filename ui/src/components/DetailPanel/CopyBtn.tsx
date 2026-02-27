import { useState, useCallback } from "react";

interface Props {
  text: string;
  title?: string;
  className?: string;
  label?: string;
}

export function CopyBtn({ text, title, className, label }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [text]
  );

  return (
    <button
      className={`copy-btn${copied ? " copied" : ""}${className ? ` ${className}` : ""}`}
      onClick={handleCopy}
      title={title ?? "Copy"}
    >
      {copied ? "Copied" : label ?? "Copy"}
    </button>
  );
}
