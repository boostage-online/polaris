import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import { buildZip, crc32, listZip } from './zip';

describe('archive ZIP sans dépendance', () => {
  it('CRC-32 de référence', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
  it('écrit des entrées deflate relisibles (répertoire central, tailles, contenu)', () => {
    const csv = toCsv(
      [
        { key: 'a', label: 'Nom' },
        { key: 'b', label: 'Montant' },
      ],
      [
        { a: 'Aïcha; "test"', b: 50000 },
        { a: 'Koffi', b: null },
      ],
    );
    const zip = buildZip([
      { name: 'eleves.csv', data: csv },
      { name: 'dossier/README.txt', data: 'Bonjour é' },
    ]);
    expect(zip.subarray(0, 4).readUInt32LE(0)).toBe(0x04034b50);
    const entries = listZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['eleves.csv', 'dossier/README.txt']);
    expect(entries[0]!.size).toBe(Buffer.byteLength(csv, 'utf8'));
    // Décompression de la première entrée depuis l'en-tête local.
    const nameLen = zip.readUInt16LE(26);
    const extraLen = zip.readUInt16LE(28);
    const packedLen = zip.readUInt32LE(18);
    const start = 30 + nameLen + extraLen;
    const raw = inflateRawSync(zip.subarray(start, start + packedLen)).toString('utf8');
    expect(raw).toBe(csv);
    expect(raw).toContain('"Aïcha; ""test"""');
  });
  it('CSV : BOM, point-virgule, booléens en français, valeurs nulles vides', () => {
    const out = toCsv(
      [
        { key: 'x', label: 'X' },
        { key: 'y', label: 'Y' },
      ],
      [{ x: true, y: null }],
    );
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('X;Y\noui;\n');
  });
});
