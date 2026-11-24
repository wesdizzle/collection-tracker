/**
 * PURE TYPESCRIPT ZIP ARCHIVE EXTRACTOR
 *
 * Extracts stored (method 0) and DEFLATE (method 8) entries from standard ZIP
 * buffers using native Web Streams (`DecompressionStream('deflate-raw')`), with
 * zero Node `fs` or shell `tar` dependencies. Safe in Cloudflare Workers & Node 24+.
 */

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

export interface ExtractedZipEntry {
  fileName: string;
  data: Uint8Array;
  text: () => string;
}

interface CentralDirEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Checks whether a buffer begins with the standard ZIP local header (`PK\x03\x04`).
 */
export function isZipBuffer(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEocdOffset(bytes: Uint8Array, view: DataView): number {
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (readUint32LE(view, i) === EOCD_SIG) {
      return i;
    }
  }
  return -1;
}

function parseCentralDirectory(
  bytes: Uint8Array,
  view: DataView,
  eocdOffset: number,
  decoder: TextDecoder,
): CentralDirEntry[] {
  const entryCount = readUint16LE(view, eocdOffset + 10);
  const cdOffset = readUint32LE(view, eocdOffset + 16);
  const entries: CentralDirEntry[] = [];
  let cursor = cdOffset;

  for (let i = 0; i < entryCount && cursor + 46 <= bytes.length; i++) {
    if (readUint32LE(view, cursor) !== CENTRAL_DIR_HEADER_SIG) {
      break;
    }
    const compressionMethod = readUint16LE(view, cursor + 10);
    const compressedSize = readUint32LE(view, cursor + 20);
    const uncompressedSize = readUint32LE(view, cursor + 24);
    const fileNameLen = readUint16LE(view, cursor + 28);
    const extraLen = readUint16LE(view, cursor + 30);
    const commentLen = readUint16LE(view, cursor + 32);
    const localHeaderOffset = readUint32LE(view, cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLen;
    if (nameEnd > bytes.length) break;

    const fileName = decoder.decode(bytes.subarray(nameStart, nameEnd));
    entries.push({
      fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor = nameEnd + extraLen + commentLen;
  }

  return entries;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Extracts the first matching entry (default: any non-directory file) from a ZIP buffer.
 */
export async function extractFirstMatchingZipEntry(
  bytes: Uint8Array,
  matcher: (fileName: string) => boolean = (name) => !name.endsWith('/'),
): Promise<ExtractedZipEntry> {
  if (!isZipBuffer(bytes)) {
    throw new Error(
      'Buffer does not start with a valid ZIP header (PK\\x03\\x04).',
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');
  const eocdOffset = findEocdOffset(bytes, view);

  let chosen: CentralDirEntry | undefined;
  if (eocdOffset >= 0) {
    const entries = parseCentralDirectory(bytes, view, eocdOffset, decoder);
    chosen = entries.find(
      (e) => !e.fileName.endsWith('/') && matcher(e.fileName),
    );
    if (!chosen) {
      throw new Error('No matching file entry found in ZIP central directory.');
    }
  } else {
    // Fallback to single Local File Header when compressedSize is explicit
    if (bytes.length < 30 || readUint32LE(view, 0) !== LOCAL_FILE_HEADER_SIG) {
      throw new Error('Invalid ZIP local file header.');
    }
    const compressionMethod = readUint16LE(view, 8);
    const compressedSize = readUint32LE(view, 18);
    const uncompressedSize = readUint32LE(view, 22);
    const fileNameLen = readUint16LE(view, 26);
    const fileName = decoder.decode(bytes.subarray(30, 30 + fileNameLen));
    if (!matcher(fileName)) {
      throw new Error('No matching file entry found in ZIP archive.');
    }
    chosen = {
      fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset: 0,
    };
  }

  const lfhOffset = chosen.localHeaderOffset;
  if (
    lfhOffset + 30 > bytes.length ||
    readUint32LE(view, lfhOffset) !== LOCAL_FILE_HEADER_SIG
  ) {
    throw new Error(`Invalid ZIP local header at offset ${lfhOffset}.`);
  }

  const lfhNameLen = readUint16LE(view, lfhOffset + 26);
  const lfhExtraLen = readUint16LE(view, lfhOffset + 28);
  const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
  const dataEnd = dataStart + chosen.compressedSize;
  if (dataEnd > bytes.length) {
    throw new Error(
      `Truncated ZIP entry "${chosen.fileName}" (expected end ${dataEnd}, got ${bytes.length}).`,
    );
  }

  const payload = bytes.subarray(dataStart, dataEnd);
  let data: Uint8Array;
  if (chosen.compressionMethod === 0) {
    data = payload.slice();
  } else if (chosen.compressionMethod === 8) {
    data = await inflateRawBytes(payload);
  } else {
    throw new Error(
      `Unsupported ZIP compression method ${chosen.compressionMethod} for "${chosen.fileName}".`,
    );
  }

  return {
    fileName: chosen.fileName,
    data,
    text: () => new TextDecoder('utf-8').decode(data),
  };
}
