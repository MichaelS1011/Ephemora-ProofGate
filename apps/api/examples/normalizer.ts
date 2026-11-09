@external("wasi_snapshot_preview1", "fd_read")
declare function fd_read(fd: i32, iovs: usize, iovsLen: i32, nread: usize): i32;

@external("wasi_snapshot_preview1", "fd_write")
declare function fd_write(fd: i32, iovs: usize, iovsLen: i32, nwritten: usize): i32;

const inputBuffer: usize = memory.data(512);
const outputBuffer: usize = memory.data(600);
const iovec: usize = memory.data(8);
const countPtr: usize = memory.data(4);

function fail(): void {
  unreachable();
}

export function myAbort(_message: usize, _fileName: usize, _line: u32, _column: u32): void {
  unreachable();
}

export function _start(): void {
  let inputLength = 0;
  while (inputLength < 512) {
    store<u32>(iovec, (inputBuffer + inputLength) as u32);
    store<u32>(iovec + 4, 512 - inputLength);
    store<u32>(countPtr, 0);
    if (fd_read(0, iovec, 1, countPtr) != 0) fail();
    const readNow = load<u32>(countPtr);
    if (readNow == 0) break;
    inputLength += readNow;
  }

  let outputLength = 0;
  let wordCount = 0;
  let inSpace = true;
  const prefix = "RESULT_JSON:{\"normalized\":\"";
  for (let i = 0; i < prefix.length; i++) store<u8>(outputBuffer + outputLength++, prefix.charCodeAt(i));
  for (let i = 0; i < inputLength; i++) {
    let value = load<u8>(inputBuffer + i);
    const whitespace = value == 9 || value == 10 || value == 11 || value == 12 || value == 13 || value == 32;
    if (whitespace) {
      if (!inSpace) {
        store<u8>(outputBuffer + outputLength++, 32);
        inSpace = true;
      }
    } else {
      if (inSpace) wordCount++;
      if (value >= 65 && value <= 90) value += 32;
      store<u8>(outputBuffer + outputLength++, value);
      inSpace = false;
    }
  }
  if (outputLength > prefix.length && load<u8>(outputBuffer + outputLength - 1) == 32) outputLength--;
  const suffix = `\",\"wordCount\":${wordCount}}\n`;
  for (let i = 0; i < suffix.length; i++) store<u8>(outputBuffer + outputLength++, suffix.charCodeAt(i));

  let written = 0;
  while (written < outputLength) {
    store<u32>(iovec, (outputBuffer + written) as u32);
    store<u32>(iovec + 4, outputLength - written);
    store<u32>(countPtr, 0);
    if (fd_write(1, iovec, 1, countPtr) != 0) fail();
    const writeNow = load<u32>(countPtr);
    if (writeNow == 0) fail();
    written += writeNow;
  }
}
