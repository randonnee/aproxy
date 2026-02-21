interface Props {
  headers?: Record<string, string>;
  label: string;
}

export function HeadersTab({ headers, label }: Props) {
  if (!headers || Object.keys(headers).length === 0) {
    return (
      <div className="detail-empty">
        No {label.toLowerCase()} headers
      </div>
    );
  }

  return (
    <table className="headers-table">
      <thead>
        <tr>
          <th>Header</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(headers).map(([key, val]) => (
          <tr key={key}>
            <td>{key}</td>
            <td>{val}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
