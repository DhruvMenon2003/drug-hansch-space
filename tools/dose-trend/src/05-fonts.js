// ---------- fonts for the PDF export ----------
// Four subset styles of Arimo (SIL Open Font License 1.1; the widths match Arial and Helvetica), deflated, with their
// advance widths. Fig.renderPDF embeds them as TrueType programs. Made by build_fonts.py.
// Either the data itself (one-file build) or the name of a JSON file beside the page, fetched the first time a PDF is made.
const PDF_FONTS = /*__PDF_FONTS__*/null;
let pdfFontsCache = null;
function getPdfFonts() {
  if (!PDF_FONTS) return Promise.resolve(null);
  if (typeof PDF_FONTS !== 'string') return Promise.resolve(PDF_FONTS);
  if (!pdfFontsCache) pdfFontsCache = fetch(PDF_FONTS).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return pdfFontsCache;
}
