/**
 * Générateur PDF minimal (PDF 1.4, Helvetica, texte seul, A5 portrait) sans dépendance : suffisant pour un
 * reçu lisible et imprimable. Le gabarit riche (logo, QR image) viendra avec le stockage objet et une librairie.
 */
export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  x?: number;
  gap?: number;
}

const PAGE_W = 420; // A5 en points
const PAGE_H = 595;
const MARGIN = 36;

function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
/** Helvetica standard (WinAnsi) : on translittère ce qui n'y entre pas. */
function toWinAnsi(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[’‘]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/[^\x20-\x7E\u00a1-\u00ff]/g, '?');
}

export function buildPdf(lines: PdfLine[]): Buffer {
  const content: string[] = [];
  let y = PAGE_H - MARGIN;
  for (const l of lines) {
    const size = l.size ?? 10;
    y -= size + (l.gap ?? 4);
    if (y < MARGIN) break;
    const font = l.bold ? '/F2' : '/F1';
    content.push(
      `BT ${font} ${size} Tf ${l.x ?? MARGIN} ${y.toFixed(1)} Td (${escapePdf(toWinAnsi(l.text))}) Tj ET`,
    );
  }
  const stream = content.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
