const PROBABILITY_BITS = 11
const START = 1 << (PROBABILITY_BITS - 1)
const MOVE_BITS = 5
const TOP = 1 << 24
const STATES = 12
const POS_STATES_MAX = 16
const LEN_LOW = 8
const LEN_MID = 8
const LEN_HIGH = 256
const LEN_STATES = 4
const END_POS_MODEL = 14
const FULL_DISTANCES = 128
const ALIGN_BITS = 4

export class LzmaError extends Error {}

class RangeDecoder {
  private range = 0xffffffff
  private code = 0

  constructor(
    private readonly input: Uint8Array,
    private at: number,
  ) {
    if (this.byte() !== 0) throw new LzmaError('This LZMA stream is damaged.')
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.byte()) >>> 0
  }

  private byte() {
    if (this.at >= this.input.length) throw new LzmaError('This LZMA stream ends early.')
    return this.input[this.at++]
  }

  private normalize() {
    if (this.range < TOP) {
      this.range = (this.range << 8) >>> 0
      this.code = ((this.code << 8) | this.byte()) >>> 0
    }
  }

  bit(probs: Uint16Array, index: number) {
    const probability = probs[index]
    const bound = (this.range >>> PROBABILITY_BITS) * probability
    let bit: number
    if (this.code < bound) {
      this.range = bound
      probs[index] = probability + (((1 << PROBABILITY_BITS) - probability) >>> MOVE_BITS)
      bit = 0
    } else {
      this.range = (this.range - bound) >>> 0
      this.code = (this.code - bound) >>> 0
      probs[index] = probability - (probability >>> MOVE_BITS)
      bit = 1
    }
    this.normalize()
    return bit
  }

  direct(count: number) {
    let result = 0
    for (let i = 0; i < count; i++) {
      this.range = this.range >>> 1
      const bit = this.code >= this.range ? 1 : 0
      if (bit) this.code = (this.code - this.range) >>> 0
      result = ((result << 1) | bit) >>> 0
      this.normalize()
    }
    return result
  }

  tree(probs: Uint16Array, offset: number, bits: number) {
    let m = 1
    for (let i = 0; i < bits; i++) m = (m << 1) | this.bit(probs, offset + m)
    return m - (1 << bits)
  }

  reverse(probs: Uint16Array, offset: number, bits: number) {
    let m = 1
    let symbol = 0
    for (let i = 0; i < bits; i++) {
      const bit = this.bit(probs, offset + m)
      m = (m << 1) | bit
      symbol |= bit << i
    }
    return symbol
  }
}

class LengthDecoder {
  private readonly choice = new Uint16Array(2).fill(START)
  private readonly low = new Uint16Array(POS_STATES_MAX << 3).fill(START)
  private readonly mid = new Uint16Array(POS_STATES_MAX << 3).fill(START)
  private readonly high = new Uint16Array(LEN_HIGH).fill(START)

  decode(range: RangeDecoder, posState: number) {
    if (range.bit(this.choice, 0) === 0) return range.tree(this.low, posState << 3, 3)
    if (range.bit(this.choice, 1) === 0) return LEN_LOW + range.tree(this.mid, posState << 3, 3)
    return LEN_LOW + LEN_MID + range.tree(this.high, 0, 8)
  }
}

export function lzmaDecode(input: Uint8Array, at: number, properties: number, size: number) {
  if (properties >= 9 * 5 * 5) throw new LzmaError('This LZMA stream has impossible settings.')
  const lc = properties % 9
  const lp = Math.floor(properties / 9) % 5
  const pb = Math.floor(properties / 45)
  const out = new Uint8Array(size)
  if (size === 0) return out
  const range = new RangeDecoder(input, at)
  const literals = new Uint16Array(0x300 << (lc + lp)).fill(START)
  const isMatch = new Uint16Array(STATES << 4).fill(START)
  const isRep = new Uint16Array(STATES).fill(START)
  const isRepG0 = new Uint16Array(STATES).fill(START)
  const isRepG1 = new Uint16Array(STATES).fill(START)
  const isRepG2 = new Uint16Array(STATES).fill(START)
  const isRep0Long = new Uint16Array(STATES << 4).fill(START)
  const slots = new Uint16Array(LEN_STATES << 6).fill(START)
  const special = new Uint16Array(1 + FULL_DISTANCES - END_POS_MODEL).fill(START)
  const align = new Uint16Array(1 << ALIGN_BITS).fill(START)
  const lengths = new LengthDecoder()
  const repLengths = new LengthDecoder()
  const posMask = (1 << pb) - 1
  const literalMask = (1 << lp) - 1
  let [state, rep0, rep1, rep2, rep3, pos] = [0, 0, 0, 0, 0, 0]
  while (pos < size) {
    const posState = pos & posMask
    if (range.bit(isMatch, (state << 4) + posState) === 0) {
      const previous = pos > 0 ? out[pos - 1] : 0
      const base = 0x300 * (((pos & literalMask) << lc) + (previous >>> (8 - lc)))
      let symbol = 1
      if (state >= 7) {
        if (rep0 >= pos) throw new LzmaError('This LZMA stream refers back past its start.')
        let match = out[pos - rep0 - 1]
        while (symbol < 0x100) {
          const matchBit = (match >>> 7) & 1
          match <<= 1
          const bit = range.bit(literals, base + ((1 + matchBit) << 8) + symbol)
          symbol = (symbol << 1) | bit
          if (matchBit !== bit) break
        }
      }
      while (symbol < 0x100) symbol = (symbol << 1) | range.bit(literals, base + symbol)
      out[pos++] = symbol - 0x100
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
      continue
    }
    let length: number
    if (range.bit(isRep, state) === 0) {
      ;[rep3, rep2, rep1] = [rep2, rep1, rep0]
      length = lengths.decode(range, posState)
      state = state < 7 ? 7 : 10
      const slot = range.tree(slots, Math.min(length, LEN_STATES - 1) << 6, 6)
      if (slot < 4) rep0 = slot
      else {
        const bits = (slot >>> 1) - 1
        let distance = ((2 | (slot & 1)) << bits) >>> 0
        if (slot < END_POS_MODEL) distance += range.reverse(special, distance - slot, bits)
        else {
          distance += range.direct(bits - ALIGN_BITS) << ALIGN_BITS
          distance += range.reverse(align, 0, ALIGN_BITS)
        }
        rep0 = distance >>> 0
        if (rep0 === 0xffffffff) break
      }
    } else {
      if (range.bit(isRepG0, state) === 0) {
        if (range.bit(isRep0Long, (state << 4) + posState) === 0) {
          if (rep0 >= pos) throw new LzmaError('This LZMA stream refers back past its start.')
          state = state < 7 ? 9 : 11
          out[pos] = out[pos - rep0 - 1]
          pos++
          continue
        }
      } else {
        let distance: number
        if (range.bit(isRepG1, state) === 0) distance = rep1
        else {
          if (range.bit(isRepG2, state) === 0) distance = rep2
          else {
            distance = rep3
            rep3 = rep2
          }
          rep2 = rep1
        }
        rep1 = rep0
        rep0 = distance
      }
      length = repLengths.decode(range, posState)
      state = state < 7 ? 8 : 11
    }
    if (rep0 >= pos) throw new LzmaError('This LZMA stream refers back past its start.')
    for (let n = Math.min(length + 2, size - pos); n > 0; n--, pos++) out[pos] = out[pos - rep0 - 1]
  }
  return out
}
