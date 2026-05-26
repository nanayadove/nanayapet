const fs = require('fs')
const zlib = require('zlib')

function readPNGChunks(buffer) {
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('不是有效的 PNG 文件')
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.slice(offset + 8, offset + 8 + len)
    chunks.push({ type, data, offset, len })
    offset += 12 + len
  }
  return chunks
}

function extractCardJson(buffer) {
  const chunks = readPNGChunks(buffer)
  for (const chunk of chunks) {
    if (chunk.type === 'tEXt' || chunk.type === 'iTXt') {
      let text = chunk.data.toString('utf-8')
      if (chunk.type === 'iTXt') {
        const nullIdx = text.indexOf('\0')
        if (nullIdx >= 0) text = text.slice(nullIdx + 1)
      }
      const sepIdx = text.indexOf('\0')
      if (sepIdx < 0) continue
      const key = text.slice(0, sepIdx)
      const val = text.slice(sepIdx + 1)
      if (key === 'ccv3') {
        try {
          const json = Buffer.from(val, 'base64').toString('utf-8')
          return JSON.parse(json)
        } catch { return null }
      }
    }
  }
  return null
}

function buildPNGChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBytes = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([typeBytes, data])
  const crc = crc32(crcData)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc, 0)
  return Buffer.concat([len, typeBytes, data, crcBuf])
}

function embedCardJson(pngBuffer, json) {
  const chunks = readPNGChunks(pngBuffer)
  const header = pngBuffer.slice(0, 8)
  const ihdrIdx = chunks.findIndex(c => c.type === 'IHDR')
  const jsonStr = JSON.stringify(json)
  const b64 = Buffer.from(jsonStr, 'utf-8').toString('base64')
  const textData = Buffer.from('ccv3\0' + b64, 'utf-8')
  const textChunk = buildPNGChunk('tEXt', textData)

  const parts = [header]
  for (let i = 0; i < chunks.length; i++) {
    parts.push(pngBuffer.slice(chunks[i].offset, chunks[i].offset + 12 + chunks[i].len))
    if (i === ihdrIdx) {
      parts.push(textChunk)
    }
  }
  return Buffer.concat(parts)
}

function crc32(buf) {
  let crc = 0xFFFFFFFF
  const table = crcTable()
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

let _table = null
function crcTable() {
  if (_table) return _table
  _table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    _table[i] = c
  }
  return _table
}

module.exports = { extractCardJson, embedCardJson }
