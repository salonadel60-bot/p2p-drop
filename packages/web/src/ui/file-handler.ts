/**
 * Web File Source - reads file data using the File API.
 */

import type { FileSource, FileSink } from '@p2p-drop/core';

/** File source backed by a browser File object */
export class BrowserFileSource implements FileSource {
  readonly size: number;

  constructor(private readonly file: File) {
    this.size = file.size;
  }

  async readChunk(offset: number, length: number): Promise<ArrayBuffer> {
    const blob = this.file.slice(offset, offset + length);
    return blob.arrayBuffer();
  }
}

/** File sink that accumulates chunks in memory, then offers download */
export class BrowserFileSink implements FileSink {
  private chunks = new Map<number, ArrayBuffer>();
  private _bytesWritten = 0;
  private _finalized = false;
  private _blob: Blob | null = null;

  constructor(
    private readonly fileName: string,
    private readonly totalSize: number,
    private readonly mimeType: string
  ) {}

  get bytesWritten(): number { return this._bytesWritten; }
  get finalized(): boolean { return this._finalized; }

  async writeChunk(offset: number, data: ArrayBuffer): Promise<void> {
    this.chunks.set(offset, data);
    this._bytesWritten += data.byteLength;
  }

  async finalize(): Promise<void> {
    // Sort chunks by offset and assemble the file
    const sortedOffsets = Array.from(this.chunks.keys()).sort((a, b) => a - b);
    const parts: ArrayBuffer[] = [];
    for (const offset of sortedOffsets) {
      parts.push(this.chunks.get(offset)!);
    }
    this._blob = new Blob(parts, { type: this.mimeType });
    this._finalized = true;
    this.chunks.clear(); // Free memory
  }

  /** Trigger browser download of the received file */
  downloadFile(): void {
    if (!this._blob) {
      throw new Error('File not finalized yet');
    }
    const url = URL.createObjectURL(this._blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /** Try to save using File System Access API (modern browsers) */
  async saveWithPicker(): Promise<boolean> {
    if (!this._blob) {
      throw new Error('File not finalized yet');
    }

    if (!('showSaveFilePicker' in window)) {
      return false;
    }

    try {
      const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
        suggestedName: this.fileName,
      });
      const writable = await handle.createWritable();
      await writable.write(this._blob);
      await writable.close();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Compute SHA-256 of a File object using streaming.
 * Handles large files by reading in chunks.
 */
export async function computeFileSHA256(file: File): Promise<string> {
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks for hashing
  const crypto = globalThis.crypto;

  // For small files, hash directly
  if (file.size <= CHUNK_SIZE) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return arrayBufferToHex(hashBuffer);
  }

  // For large files, we need to use a streaming approach
  // Web Crypto doesn't support streaming SHA-256 natively,
  // so we compute it on the full file
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return arrayBufferToHex(hashBuffer);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const uint8 = new Uint8Array(buffer);
  return Array.from(uint8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
