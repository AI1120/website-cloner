/** A small RFC 4180 reader and writer for importing and exporting table rows. */

const DELIMITERS = [",", ";", "\t"];

/**
 * Spreadsheets in some locales save "CSV" with semicolons or tabs. Picks the
 * separator that appears most on the first line, outside quoted text.
 */
function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
    } else if (!quoted) {
      if (character === "\n" || character === "\r") break;
      const count = counts.get(character);
      if (count !== undefined) counts.set(character, count + 1);
    }
  }
  let best = ",";
  for (const delimiter of DELIMITERS) {
    if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) best = delimiter;
  }
  return best;
}

/**
 * Splits CSV text into records of fields. Handles quoted fields (with commas,
 * line breaks and doubled quotes inside), any line ending, a leading byte
 * order mark, and skips blank lines.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];

  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  // A line holding just `""` is a record with one empty field, not a blank line.
  let sawQuote = false;

  const endRecord = () => {
    record.push(field);
    field = "";
    if (record.length > 1 || record[0] !== "" || sawQuote) records.push(record);
    record = [];
    sawQuote = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character !== '"') {
        field += character;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = false;
      }
    } else if (character === '"' && field === "") {
      inQuotes = true;
      sawQuote = true;
    } else if (character === delimiter) {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      endRecord();
    } else if (character === "\r") {
      if (text[index + 1] === "\n") index += 1;
      endRecord();
    } else {
      field += character;
    }
  }
  if (field !== "" || record.length > 0 || sawQuote) endRecord();

  return records;
}

function csvField(value: string): string {
  const needsQuotes = /[",\r\n]/.test(value) || value !== value.trim();
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Joins records into CSV text with CRLF line endings. */
export function toCsv(records: string[][]): string {
  return records
    .map((record) => {
      // A lone empty field would otherwise read back as a blank line.
      const line = record.length === 1 && record[0] === "" ? '""' : record.map(csvField).join(",");
      return line + "\r\n";
    })
    .join("");
}
