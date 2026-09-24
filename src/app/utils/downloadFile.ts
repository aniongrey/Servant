function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

export function downloadJsonFile(filename: string, value: unknown): void {
  downloadBlob(filename, new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }));
}

export function downloadTextFile(filename: string, value: string): void {
  downloadBlob(filename, new Blob([value], { type: 'text/markdown;charset=utf-8' }));
}
