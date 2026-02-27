import { useState, useCallback } from "react";
import { createPortal } from "react-dom";

interface Props {
  headers?: Record<string, string>;
  label: string;
}

export function HeadersTab({ headers, label }: Props) {
  const [toast, setToast] = useState<{ top: number; left: number; key: number } | null>(null);

  const handleRowClick = useCallback((e: React.MouseEvent, key: string, val: string) => {
    navigator.clipboard.writeText(`${key}: ${val}`).then(() => {
      setToast({ top: e.clientY - 30, left: e.clientX, key: Date.now() });
      setTimeout(() => setToast(null), 600);
    });
  }, []);

  if (!headers || Object.keys(headers).length === 0) {
    return (
      <div className="detail-empty">
        No {label.toLowerCase()} headers
      </div>
    );
  }

  return (
    <>
      <table className="headers-table">
        <thead>
          <tr>
            <th>Header</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(headers).map(([key, val]) => (
            <tr
              key={key}
              className="header-row-clickable"
              onClick={(e) => handleRowClick(e, key, val)}
            >
              <td>{key}</td>
              <td>{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {toast && createPortal(
        <div className="copy-toast" key={toast.key} style={{ top: toast.top, left: toast.left }}>
          Copied
        </div>,
        document.body
      )}
    </>
  );
}
