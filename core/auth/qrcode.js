/**
 * Minimal Zero-Dependency QR Code Generator
 * Pure JavaScript implementation of QR Code Model 2 (ISO/IEC 18004)
 * Supports Byte mode (UTF-8 / ASCII) with Error Correction Levels (L, M, Q, H)
 * Versions 1 to 10 (sufficient for URIs up to 271 bytes)
 */

// Error correction levels
const ECC_LEVELS = {
  L: 1, // Low (~7%)
  M: 0, // Medium (~15%)
  Q: 3, // Quartile (~25%)
  H: 2, // High (~30%)
};

// Format info bits for each (ECC, mask) combination (15 bits, BCH encoded)
const FORMAT_INFO = [
  [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976], // M (0)
  [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0], // L (1)
  [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed], // H (2)
  [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b], // Q (3)
];

// Capacity and ECC table for Versions 1-10:
// [version, totalDataBytes, ecBytesPerBlock, numBlocksGroup1, dataBytesBlock1, numBlocksGroup2, dataBytesBlock2]
// ECC order: [M, L, H, Q]
const VERSION_TABLE = {
  1: {
    M: { totalCodewords: 26, ecPerBlock: 10, b1: 1, d1: 16, b2: 0, d2: 0 },
    L: { totalCodewords: 26, ecPerBlock: 7, b1: 1, d1: 19, b2: 0, d2: 0 },
    H: { totalCodewords: 26, ecPerBlock: 17, b1: 1, d1: 9, b2: 0, d2: 0 },
    Q: { totalCodewords: 26, ecPerBlock: 13, b1: 1, d1: 13, b2: 0, d2: 0 },
  },
  2: {
    M: { totalCodewords: 44, ecPerBlock: 16, b1: 1, d1: 28, b2: 0, d2: 0 },
    L: { totalCodewords: 44, ecPerBlock: 10, b1: 1, d1: 34, b2: 0, d2: 0 },
    H: { totalCodewords: 44, ecPerBlock: 28, b1: 1, d1: 16, b2: 0, d2: 0 },
    Q: { totalCodewords: 44, ecPerBlock: 22, b1: 1, d1: 22, b2: 0, d2: 0 },
  },
  3: {
    M: { totalCodewords: 70, ecPerBlock: 26, b1: 1, d1: 44, b2: 0, d2: 0 },
    L: { totalCodewords: 70, ecPerBlock: 15, b1: 1, d1: 55, b2: 0, d2: 0 },
    H: { totalCodewords: 70, ecPerBlock: 22, b1: 2, d1: 13, b2: 0, d2: 0 },
    Q: { totalCodewords: 70, ecPerBlock: 18, b1: 2, d1: 17, b2: 0, d2: 0 },
  },
  4: {
    M: { totalCodewords: 100, ecPerBlock: 18, b1: 2, d1: 32, b2: 0, d2: 0 },
    L: { totalCodewords: 100, ecPerBlock: 20, b1: 1, d1: 80, b2: 0, d2: 0 },
    H: { totalCodewords: 100, ecPerBlock: 16, b1: 4, d1: 9, b2: 0, d2: 0 },
    Q: { totalCodewords: 100, ecPerBlock: 26, b1: 2, d1: 24, b2: 0, d2: 0 },
  },
  5: {
    M: { totalCodewords: 134, ecPerBlock: 24, b1: 2, d1: 43, b2: 0, d2: 0 },
    L: { totalCodewords: 134, ecPerBlock: 26, b1: 1, d1: 108, b2: 0, d2: 0 },
    H: { totalCodewords: 134, ecPerBlock: 22, b1: 2, d1: 11, b2: 2, d2: 12 },
    Q: { totalCodewords: 134, ecPerBlock: 18, b1: 2, d1: 15, b2: 2, d2: 16 },
  },
  6: {
    M: { totalCodewords: 172, ecPerBlock: 16, b1: 4, d1: 27, b2: 0, d2: 0 },
    L: { totalCodewords: 172, ecPerBlock: 18, b1: 2, d1: 68, b2: 0, d2: 0 },
    H: { totalCodewords: 172, ecPerBlock: 28, b1: 4, d1: 15, b2: 0, d2: 0 },
    Q: { totalCodewords: 172, ecPerBlock: 24, b1: 4, d1: 19, b2: 0, d2: 0 },
  },
  7: {
    M: { totalCodewords: 196, ecPerBlock: 18, b1: 4, d1: 31, b2: 0, d2: 0 },
    L: { totalCodewords: 196, ecPerBlock: 20, b1: 2, d1: 78, b2: 0, d2: 0 },
    H: { totalCodewords: 196, ecPerBlock: 26, b1: 4, d1: 13, b2: 1, d2: 14 },
    Q: { totalCodewords: 196, ecPerBlock: 18, b1: 2, d1: 14, b2: 4, d2: 15 },
  },
  8: {
    M: { totalCodewords: 242, ecPerBlock: 22, b1: 2, d1: 38, b2: 2, d2: 39 },
    L: { totalCodewords: 242, ecPerBlock: 24, b1: 2, d1: 97, b2: 0, d2: 0 },
    H: { totalCodewords: 242, ecPerBlock: 26, b1: 4, d1: 14, b2: 2, d2: 15 },
    Q: { totalCodewords: 242, ecPerBlock: 22, b1: 4, d1: 18, b2: 2, d2: 19 },
  },
  9: {
    M: { totalCodewords: 292, ecPerBlock: 22, b1: 3, d1: 36, b2: 2, d2: 37 },
    L: { totalCodewords: 292, ecPerBlock: 30, b1: 2, d1: 116, b2: 0, d2: 0 },
    H: { totalCodewords: 292, ecPerBlock: 24, b1: 4, d1: 12, b2: 4, d2: 13 },
    Q: { totalCodewords: 292, ecPerBlock: 20, b1: 4, d1: 16, b2: 4, d2: 17 },
  },
  10: {
    M: { totalCodewords: 346, ecPerBlock: 26, b1: 4, d1: 43, b2: 1, d2: 44 },
    L: { totalCodewords: 346, ecPerBlock: 18, b1: 2, d1: 68, b2: 2, d2: 69 },
    H: { totalCodewords: 346, ecPerBlock: 28, b1: 6, d1: 15, b2: 2, d2: 16 },
    Q: { totalCodewords: 346, ecPerBlock: 24, b1: 6, d1: 19, b2: 2, d2: 20 },
  },
};

// Alignment pattern center positions for versions 2-10
const ALIGNMENT_PATTERN_POSITIONS = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// Precompute GF(256) log and exp tables
const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);
let gfVal = 1;
for (let i = 0; i < 255; i++) {
  GF256_EXP[i] = gfVal;
  GF256_EXP[i + 255] = gfVal;
  GF256_LOG[gfVal] = i;
  gfVal <<= 1;
  if (gfVal & 256) gfVal ^= 0x11d;
}

function gmul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF256_EXP[GF256_LOG[a] + GF256_LOG[b]];
}

function rsGenPoly(numEc) {
  let poly = [1];
  for (let i = 0; i < numEc; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const root = GF256_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gmul(poly[j], root);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsCompute(data, numEc) {
  const gen = rsGenPoly(numEc);
  const result = new Array(numEc).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < numEc; i++) {
      result[i] ^= gmul(gen[i], factor);
    }
  }
  return result;
}

/**
 * Determine the smallest QR Version that can hold the data bytes
 */
function findBestVersion(dataLength, ecc = 'M') {
  for (let v = 1; v <= 10; v++) {
    const table = VERSION_TABLE[v][ecc];
    const maxDataBytes = table.b1 * table.d1 + table.b2 * table.d2;
    // Overhead: 4 bits mode + (8 or 16 bits count)
    const countBits = v <= 9 ? 8 : 16;
    const available = Math.floor((maxDataBytes * 8 - 4 - countBits) / 8);
    if (dataLength <= available) {
      return v;
    }
  }
  throw new Error(`Data is too long for QR Code versions 1-10 (${dataLength} bytes)`);
}

/**
 * Encode raw text to bitstream with padding and interleaving
 */
function encodeData(text, version, ecc = 'M') {
  const bytes = Buffer.from(text, 'utf8');
  const table = VERSION_TABLE[version][ecc];
  const totalDataBytes = table.b1 * table.d1 + table.b2 * table.d2;

  // Bit buffer
  let bits = '';
  // 1. Mode indicator: 0100 for 8-bit byte mode
  bits += '0100';
  // 2. Character count indicator
  const countBits = version <= 9 ? 8 : 16;
  bits += bytes.length.toString(2).padStart(countBits, '0');
  // 3. Data bytes
  for (let i = 0; i < bytes.length; i++) {
    bits += bytes[i].toString(2).padStart(8, '0');
  }

  // 4. Terminator (up to 4 zeros)
  const maxBits = totalDataBytes * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  bits += '0'.repeat(termLen);

  // 5. Pad to multiple of 8
  while (bits.length % 8 !== 0) {
    bits += '0';
  }

  // 6. Pad bytes (0xEC, 0x11 alternating)
  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    dataBytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (dataBytes.length < totalDataBytes) {
    dataBytes.push(padBytes[padIdx % 2]);
    padIdx++;
  }

  // 7. Group into blocks and calculate ECC
  const blocks = [];
  const ecBlocks = [];
  let byteOffset = 0;

  for (let i = 0; i < table.b1; i++) {
    const block = dataBytes.slice(byteOffset, byteOffset + table.d1);
    blocks.push(block);
    ecBlocks.push(rsCompute(block, table.ecPerBlock));
    byteOffset += table.d1;
  }
  for (let i = 0; i < table.b2; i++) {
    const block = dataBytes.slice(byteOffset, byteOffset + table.d2);
    blocks.push(block);
    ecBlocks.push(rsCompute(block, table.ecPerBlock));
    byteOffset += table.d2;
  }

  // 8. Interleave data bytes
  const finalCodewords = [];
  const maxDataLen = Math.max(table.d1, table.d2 || 0);
  for (let j = 0; j < maxDataLen; j++) {
    for (let i = 0; i < blocks.length; i++) {
      if (j < blocks[i].length) {
        finalCodewords.push(blocks[i][j]);
      }
    }
  }

  // 9. Interleave error correction bytes
  for (let j = 0; j < table.ecPerBlock; j++) {
    for (let i = 0; i < ecBlocks.length; i++) {
      finalCodewords.push(ecBlocks[i][j]);
    }
  }

  return finalCodewords;
}

/**
 * Generate 2D QR matrix
 */
function createQrMatrix(text, options = {}) {
  const ecc = (options.ecc || 'M').toUpperCase();
  const version = options.version || findBestVersion(Buffer.byteLength(text, 'utf8'), ecc);
  const size = 17 + version * 4;
  const codewords = encodeData(text, version, ecc);

  // Initialize matrix: -1 represents unset, 0 false/white, 1 true/black
  const matrix = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const isFunction = Array.from({ length: size }, () => new Uint8Array(size).fill(0));

  function setFunction(r, c, val) {
    matrix[r][c] = val ? 1 : 0;
    isFunction[r][c] = 1;
  }

  // 1. Finder patterns (7x7) + separators
  function drawFinder(row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
            const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            setFunction(nr, nc, isBorder || isCenter);
          } else {
            setFunction(nr, nc, 0); // Separator
          }
        }
      }
    }
  }
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Alignment patterns for Version >= 2
  if (version >= 2) {
    const coords = ALIGNMENT_PATTERN_POSITIONS[version];
    for (const r of coords) {
      for (const c of coords) {
        // Skip if overlaps finder
        if ((r < 9 && c < 9) || (r < 9 && c > size - 10) || (r > size - 10 && c < 9)) {
          continue;
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBorder = Math.abs(dr) === 2 || Math.abs(dc) === 2;
            const isCenter = dr === 0 && dc === 0;
            setFunction(r + dr, c + dc, isBorder || isCenter);
          }
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6][i]) setFunction(6, i, i % 2 === 0);
    if (!isFunction[i][6]) setFunction(i, 6, i % 2 === 0);
  }

  // 4. Dark module
  setFunction(size - 8, 8, 1);

  // 5. Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (!isFunction[8][i]) isFunction[8][i] = 1;
    if (!isFunction[i][8]) isFunction[i][8] = 1;
  }
  for (let i = size - 8; i < size; i++) {
    if (!isFunction[8][i]) isFunction[8][i] = 1;
    if (!isFunction[i][8]) isFunction[i][8] = 1;
  }

  // 6. Place data bits in matrix (zig-zag from right to left)
  let bitIdx = 0;
  const totalBits = codewords.length * 8;

  function getBit(idx) {
    if (idx >= totalBits) return 0;
    const byte = codewords[Math.floor(idx / 8)];
    return (byte >> (7 - (idx % 8))) & 1;
  }

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing line
    const rows = [];
    if (upward) {
      for (let r = size - 1; r >= 0; r--) rows.push(r);
    } else {
      for (let r = 0; r < size; r++) rows.push(r);
    }
    for (const r of rows) {
      for (let c = right; c >= right - 1; c--) {
        if (!isFunction[r][c]) {
          matrix[r][c] = getBit(bitIdx);
          bitIdx++;
        }
      }
    }
    upward = !upward;
  }

  // 7. Choose mask pattern with lowest penalty (or mask 0 by default)
  const maskPattern = options.mask != null ? options.mask : chooseBestMask(matrix, isFunction, size);

  // Apply mask and write format info
  const eccIdx = ECC_LEVELS[ecc];
  const formatInfo = FORMAT_INFO[eccIdx][maskPattern];

  // Write format info to reserved areas
  for (let i = 0; i < 15; i++) {
    const bit = (formatInfo >> (14 - i)) & 1;
    // Around top-left
    if (i < 6) matrix[8][i] = bit;
    else if (i === 6) matrix[8][7] = bit;
    else if (i === 7) matrix[8][8] = bit;
    else if (i === 8) matrix[7][8] = bit;
    else matrix[14 - i][8] = bit;

    // Around top-right and bottom-left
    if (i < 8) {
      matrix[size - 1 - i][8] = bit;
    } else {
      matrix[8][size - 15 + i] = bit;
    }
  }

  // Final boolean matrix
  const result = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      if (isFunction[r][c]) {
        row.push(matrix[r][c] === 1);
      } else {
        const masked = maskCondition(maskPattern, r, c);
        const bit = matrix[r][c] ^ (masked ? 1 : 0);
        row.push(bit === 1);
      }
    }
    result.push(row);
  }

  return { matrix: result, size, version };
}

function maskCondition(pattern, r, c) {
  switch (pattern) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function chooseBestMask(matrix, isFunction, size) {
  // Evaluates penalty scores for masks 0-7, returning the one with lowest penalty
  let bestMask = 0;
  let minPenalty = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    let penalty = 0;
    // Calculate penalty rule 1 (runs of 5+ same color) and rule 2 (2x2 blocks)
    for (let r = 0; r < size; r++) {
      let runColor = -1;
      let runLen = 0;
      for (let c = 0; c < size; c++) {
        const val = isFunction[r][c] ? matrix[r][c] : (matrix[r][c] ^ (maskCondition(mask, r, c) ? 1 : 0));
        if (val === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runColor = val;
          runLen = 1;
        }
        // 2x2 blocks
        if (r < size - 1 && c < size - 1) {
          const v2 = isFunction[r][c+1] ? matrix[r][c+1] : (matrix[r][c+1] ^ (maskCondition(mask, r, c+1) ? 1 : 0));
          const v3 = isFunction[r+1][c] ? matrix[r+1][c] : (matrix[r+1][c] ^ (maskCondition(mask, r+1, c) ? 1 : 0));
          const v4 = isFunction[r+1][c+1] ? matrix[r+1][c+1] : (matrix[r+1][c+1] ^ (maskCondition(mask, r+1, c+1) ? 1 : 0));
          if (val === v2 && val === v3 && val === v4) {
            penalty += 3;
          }
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = mask;
    }
  }
  return bestMask;
}

/**
 * Generate SVG string from QR Code
 * @param {string} text - Text to encode
 * @param {Object} [options] - Options
 * @param {number} [options.margin=4] - Quiet zone margin (modules)
 * @param {number} [options.size=256] - Width and height in px
 * @param {string} [options.darkColor='#000000'] - Dark module color
 * @param {string} [options.lightColor='#ffffff'] - Light module color (or 'none')
 * @returns {string} SVG markup
 */
function generateQrSvg(text, options = {}) {
  const { matrix, size } = createQrMatrix(text, options);
  const margin = options.margin != null ? options.margin : 4;
  const viewBoxSize = size + margin * 2;
  const darkColor = options.darkColor || '#000000';
  const lightColor = options.lightColor || '#ffffff';
  const width = options.size || 256;
  const height = options.size || 256;

  let pathData = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        pathData += `M${c + margin} ${r + margin}h1v1h-1z `;
      }
    }
  }

  const bgRect = lightColor && lightColor !== 'none'
    ? `<rect width="${viewBoxSize}" height="${viewBoxSize}" fill="${lightColor}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" width="${width}" height="${height}" shape-rendering="crispEdges">${bgRect}<path d="${pathData.trim()}" fill="${darkColor}"/></svg>`;
}

/**
 * Generate Data URI from SVG
 */
function generateQrDataUri(text, options = {}) {
  const svg = generateQrSvg(text, options);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

module.exports = {
  createQrMatrix,
  generateQrSvg,
  generateQrDataUri,
};
