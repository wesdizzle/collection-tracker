import { describe, it, expect } from 'vitest';
import { extractFirstMatchingZipEntry, isZipBuffer } from './zip.js';

function writeUint16LE(arr: number[], val: number): void {
  arr.push(val & 0xff, (val >> 8) & 0xff);
}

function writeUint32LE(arr: number[], val: number): void {
  arr.push(
    val & 0xff,
    (val >> 8) & 0xff,
    (val >> 16) & 0xff,
    (val >> 24) & 0xff,
  );
}

async function buildTestZip(
  entries: Array<{ name: string; content: string; compress: boolean }>,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const out: number[] = [];
  const cdEntries: Array<{
    nameBytes: Uint8Array;
    method: number;
    compressedSize: number;
    uncompressedSize: number;
    offset: number;
  }> = [];

  for (const entry of entries) {
    const raw = encoder.encode(entry.content);
    let payload: Uint8Array;
    const method = entry.compress ? 8 : 0;
    if (entry.compress) {
      const stream = new Blob([raw])
        .stream()
        .pipeThrough(new CompressionStream('deflate-raw'));
      payload = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      payload = raw;
    }

    const nameBytes = encoder.encode(entry.name);
    const offset = out.length;
    writeUint32LE(out, 0x04034b50);
    writeUint16LE(out, 20);
    writeUint16LE(out, 0);
    writeUint16LE(out, method);
    writeUint16LE(out, 0);
    writeUint16LE(out, 0);
    writeUint32LE(out, 0);
    writeUint32LE(out, payload.length);
    writeUint32LE(out, raw.length);
    writeUint16LE(out, nameBytes.length);
    writeUint16LE(out, 0);
    out.push(...nameBytes, ...payload);

    cdEntries.push({
      nameBytes,
      method,
      compressedSize: payload.length,
      uncompressedSize: raw.length,
      offset,
    });
  }

  const cdStart = out.length;
  for (const cd of cdEntries) {
    writeUint32LE(out, 0x02014b50);
    writeUint16LE(out, 20);
    writeUint16LE(out, 20);
    writeUint16LE(out, 0);
    writeUint16LE(out, cd.method);
    writeUint16LE(out, 0);
    writeUint16LE(out, 0);
    writeUint32LE(out, 0);
    writeUint32LE(out, cd.compressedSize);
    writeUint32LE(out, cd.uncompressedSize);
    writeUint16LE(out, cd.nameBytes.length);
    writeUint16LE(out, 0);
    writeUint16LE(out, 0);
    writeUint16LE(out, 0);
    writeUint16LE(out, 0);
    writeUint32LE(out, 0);
    writeUint32LE(out, cd.offset);
    out.push(...cd.nameBytes);
  }
  const cdSize = out.length - cdStart;

  writeUint32LE(out, 0x06054b50);
  writeUint16LE(out, 0);
  writeUint16LE(out, 0);
  writeUint16LE(out, cdEntries.length);
  writeUint16LE(out, cdEntries.length);
  writeUint32LE(out, cdSize);
  writeUint32LE(out, cdStart);
  writeUint16LE(out, 0);

  return new Uint8Array(out);
}

describe('shared/zip', () => {
  it('detects ZIP magic headers and rejects HTML responses', () => {
    expect(isZipBuffer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe(
      true,
    );
    expect(isZipBuffer(new TextEncoder().encode('<!DOCTYPE html>'))).toBe(
      false,
    );
  });

  it('extracts deflated and stored entries matching filter cleanly', async () => {
    const zipBytes = await buildTestZip([
      { name: 'readme.txt', content: 'ignore me', compress: false },
      {
        name: 'Microsoft - Xbox One - Datfile.dat',
        content:
          '<datafile><header><name>Microsoft - Xbox One</name></header></datafile>',
        compress: true,
      },
    ]);

    const extracted = await extractFirstMatchingZipEntry(
      zipBytes,
      (name) => name.endsWith('.dat') || name.endsWith('.xml'),
    );

    expect(extracted.fileName).toBe('Microsoft - Xbox One - Datfile.dat');
    expect(extracted.text()).toContain('Microsoft - Xbox One');
  });

  it('throws cleanly when no matching entry exists or buffer is invalid', async () => {
    const zipBytes = await buildTestZip([
      { name: 'readme.txt', content: 'hello', compress: false },
    ]);

    await expect(
      extractFirstMatchingZipEntry(zipBytes, (name) => name.endsWith('.dat')),
    ).rejects.toThrow(/No matching file entry/);

    await expect(
      extractFirstMatchingZipEntry(
        new TextEncoder().encode('<html>error</html>'),
      ),
    ).rejects.toThrow(/ZIP header/);
  });
});
