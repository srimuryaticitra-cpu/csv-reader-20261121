// Kura Fast CSV — a faster drop-in for csv-reader 1.0.0 (make.fun's own reference).
//
// Same answers as csv-reader 1.0.0 on every input, byte for byte in the JSON sense:
// {columns, rows, errors} for {text, header}. The reference reads one character at a
// time and builds every field by concatenation; this one jumps with indexOf to the next
// special character (comma, LF, CR, quote) and slices whole fields at once, so the
// common case — a plain unquoted field — costs a few native scans and one slice.
//
// ATM twist (Amati, Tiru, Modifikasi): the winning shape is the d3-dsv-style
// indexOf/slice scanner the house measured at ~0.73 s vs the baseline's ~1.38 s.
// Imitated: the scanner shape. Modified: exact csv-reader broken-row semantics kept
// (stray_cr, quote_junk, unterminated_quote, short/long_row with their line/row),
// plus a Kura touch — the parser never allocates for a clean field (one slice,
// no joins, no per-field closures) and only pays for segments when a row is broken.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const COMMA = 0; // a field ended at a comma: the record goes on
const LINE_BREAK = 1; // a field ended at a line break: the record ends
const END = 2; // a field ended at the end of the text: the record ends

/** csv-reader 1.0.0's answer for one case's input, faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The last unquoted field read, shared out-params so the hot path allocates no
  // result object per field (about a million fields a set).
  let fValue = '';
  let fEnded = 0;
  let fAdded = 0;

  // Reads an unquoted field starting at pos, onto `init`. A CR not followed by LF is
  // dropped (stray_cr). Writes the field to fValue/fEnded and the characters kept
  // during this read (not `init`) to fAdded, which is what quote_junk watches.
  function readUnquoted(init) {
    let parts = null; // segments kept so far, only built when a stray CR splits the field
    let p = pos;
    let added = 0;
    for (;;) {
      const ci = text.indexOf(',', p);
      const ni = text.indexOf('\n', p);
      const ri = text.indexOf('\r', p);
      let m = ci;
      let kind = COMMA;
      if (ni !== -1 && (m === -1 || ni < m)) {
        m = ni;
        kind = LINE_BREAK;
      }
      if (ri !== -1 && (m === -1 || ri < m)) {
        m = ri;
        kind = 2; // CR: CRLF ends the field, a lone CR is dropped
      }
      if (m === -1) {
        const tail = text.slice(p);
        pos = n;
        fAdded = added + tail.length;
        fValue = parts === null ? init + tail : parts.join('') + tail;
        fEnded = END;
        return;
      }
      if (kind === COMMA) {
        const seg = text.slice(p, m);
        pos = m + 1;
        fAdded = added + seg.length;
        fValue = parts === null ? init + seg : parts.join('') + seg;
        fEnded = COMMA;
        return;
      }
      if (kind === LINE_BREAK) {
        const seg = text.slice(p, m);
        pos = m + 1;
        line += 1;
        fAdded = added + seg.length;
        fValue = parts === null ? init + seg : parts.join('') + seg;
        fEnded = LINE_BREAK;
        return;
      }
      // A CR: CRLF ends the field, a lone CR is dropped with a stray_cr error.
      if (text.charCodeAt(m + 1) === 10) {
        const seg = text.slice(p, m);
        pos = m + 2;
        line += 1;
        fAdded = added + seg.length;
        fValue = parts === null ? init + seg : parts.join('') + seg;
        fEnded = LINE_BREAK;
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      const kept = text.slice(p, m);
      added += kept.length; // kept chars before the dropped CR count as added
      if (parts === null) parts = [init, kept];
      else parts.push(kept);
      p = m + 1;
    }
  }

  // A quoted segment [a, b): CRLF and a lone CR inside it each read as one LF, and
  // every line break inside it moves `line` on. Returns the segment as it reads.
  function finishSeg(a, b) {
    let s = text.slice(a, b);
    let i = s.indexOf('\n');
    while (i !== -1) {
      line += 1;
      i = s.indexOf('\n', i + 1);
    }
    if (s.indexOf('\r') !== -1) {
      let j = s.indexOf('\r');
      while (j !== -1) {
        if (s.charCodeAt(j + 1) !== 10) line += 1; // a lone CR is a line of its own
        j = s.indexOf('\r', j + 1);
      }
      s = s.replace(/\r\n?/g, '\n');
    }
    return s;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let segStart = pos + 1;
    let scan = pos + 1;
    let parts = null;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it
        // is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return { value: fValue, ended: fEnded, added: 0 };
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote inside the field.
        if (parts === null) parts = [];
        parts.push(finishSeg(segStart, q));
        parts.push('"');
        scan = q + 2;
        segStart = q + 2;
        continue;
      }
      // The closing quote.
      const last = finishSeg(segStart, q);
      const value = parts === null ? last : parts.join('') + last;
      pos = q + 1;
      if (pos >= n) return { value, ended: END, added: 0 };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA, added: 0 };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK, added: 0 };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK, added: 0 };
      }
      // What follows the closing quote is appended as it stands, up to the next
      // comma or line break.
      readUnquoted(value);
      if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return { value: fValue, ended: fEnded, added: 0 };
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) {
        const field = readQuoted();
        fields.push(field.value);
        ended = field.ended;
      } else {
        readUnquoted('');
        fields.push(fValue);
        ended = fEnded;
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
