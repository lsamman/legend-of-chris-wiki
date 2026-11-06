// Word and file support for the writing room, with no libraries:
//   deltaToDocx(ops)      -> a .docx Blob, with bold, italic, underline, colours, fonts, sizes, headings, lists, alignment, links
//   importFile(file)      -> { ops, words, notes } from a .docx, .pages or .txt file, as Quill delta operations
// A .docx or .pages file is a zip; reading one uses the browser's built-in DecompressionStream.

const enc = new TextEncoder();

// ---------------------------------------------------------------- zip (read and write)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files) {          // files: [[name, string | Uint8Array]] -> Blob (stored, no compression)
  const parts = [], central = [];
  let offset = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, data] of files) {
    const nm = enc.encode(name), body = typeof data === "string" ? enc.encode(data) : data, crc = crc32(body);
    const head = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(body.length), ...u32(body.length), ...u16(nm.length), ...u16(0)]);
    parts.push(head, nm, body);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(body.length), ...u32(body.length),
      ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nm);
    offset += head.length + nm.length + body.length;
  }
  const csize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(offset), 0, 0]);
  return new Blob([...parts, ...central, end], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

async function inflate(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open zip files. Update your browser, or save the file as .txt.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buf) {     // -> Map name -> () => Promise<Uint8Array>
  const b = new Uint8Array(buf), v = new DataView(buf);
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("That file isn't a zip package.");
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    out.set(name, async () => {
      const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
      const data = b.subarray(start, start + csize);
      return method === 0 ? data : method === 8 ? inflate(data) : Promise.reject(new Error("Unsupported zip compression."));
    });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// ---------------------------------------------------------------- export: Quill delta -> .docx
const esc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SIZE_PT = { small: 9, large: 18, huge: 30 };           // what the editor shows: 16px body, 0.75em / 1.5em / 2.5em
const HEAD = { 1: { pt: 32, before: 1080, after: 390 }, 2: { pt: 20, before: 0, after: 330 }, 3: { pt: 14, before: 330, after: 120 } };
const FONT = { comic: "Comic Sans MS" };

function hex(c) {
  if (!c) return null;
  let m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c.trim());
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(c);
  return m ? [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase() : null;
}

function runXml(text, a, link) {
  let pr = "";
  if (link) pr += '<w:rStyle w:val="Hyperlink"/>';
  if (a.font && FONT[a.font]) pr += `<w:rFonts w:ascii="${FONT[a.font]}" w:hAnsi="${FONT[a.font]}" w:cs="${FONT[a.font]}"/>`;
  if (a.bold) pr += "<w:b/><w:bCs/>";
  if (a.italic) pr += "<w:i/><w:iCs/>";
  if (a.strike) pr += "<w:strike/>";
  const col = hex(a.color); if (col) pr += `<w:color w:val="${col}"/>`;
  if (a.size && SIZE_PT[a.size]) pr += `<w:sz w:val="${SIZE_PT[a.size] * 2}"/><w:szCs w:val="${SIZE_PT[a.size] * 2}"/>`;
  const bg = hex(a.background); if (bg) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>`;
  if (a.underline) pr += '<w:u w:val="single"/>';
  const rpr = pr ? `<w:rPr>${pr}</w:rPr>` : "";
  return text.split(/(\t)/).map(t => t === "\t" ? `<w:r>${rpr}<w:tab/></w:r>` : t ? `<w:r>${rpr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>` : "").join("");
}

export function deltaToDocx(ops, title = "The Legend of Chris") {
  // 1. ops -> lines { runs: [{text, attrs}], attrs }
  const lines = [];
  let runs = [];
  const push = attrs => { lines.push({ runs, attrs: attrs || {} }); runs = []; };
  for (const op of ops) {
    const a = op.attributes || {};
    if (typeof op.insert === "string") {
      const parts = op.insert.split("\n");
      parts.forEach((t, i) => {
        if (t) runs.push({ text: t, attrs: a });
        if (i < parts.length - 1) push(a);
      });
    } else if (op.insert && op.insert.image) {
      runs.push({ text: "[Picture: " + op.insert.image + "]", attrs: { ...a, link: op.insert.image } });
    }
  }
  if (runs.length) push({});
  // 2. lines -> paragraphs
  const links = [];                 // external link targets -> r:id
  const nums = [];                  // ordered lists: one w:num each, so numbering restarts
  let body = "", prevList = null;
  for (const ln of lines) {
    const A = ln.attrs;
    let ppr = "", pre = "";
    if (A.header && HEAD[A.header]) ppr += `<w:pStyle w:val="Heading${A.header}"/>`;
    else if (A.blockquote) ppr += '<w:pStyle w:val="Quote"/>';
    if (A.list) {
      const kind = A.list === "ordered" ? "ordered" : "bullet";
      if (kind === "ordered" && (!prevList || prevList.kind !== "ordered")) nums.push(nums.length + 10);
      const numId = kind === "bullet" ? 1 : nums[nums.length - 1];
      ppr += `<w:numPr><w:ilvl w:val="${Math.min(8, A.indent || 0)}"/><w:numId w:val="${numId}"/></w:numPr>`;
      prevList = { kind };
    } else {
      prevList = null;
      if (A.indent && !A.header) ppr += `<w:ind w:left="${720 * Math.min(8, A.indent) + (A.blockquote ? 720 : 0)}"/>`;
    }
    const jc = { center: "center", right: "right", justify: "both" }[A.align];
    if (jc) ppr += `<w:jc w:val="${jc}"/>`;
    let inner = "";
    for (const r of ln.runs) {
      const a = { ...r.attrs };
      if (A.header) { delete a.size; delete a.bold; }
      if (a.link) {
        let id = links.indexOf(a.link); if (id < 0) id = links.push(a.link) - 1;
        inner += `<w:hyperlink r:id="rIdL${id}" w:history="1">${runXml(r.text, a, true)}</w:hyperlink>`;
      } else inner += runXml(r.text, a, false);
    }
    body += `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${inner}</w:p>`;
  }
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  // paragraph spacing as the editor shows it: 14px after, line height 1.62
  const hstyle = n => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="${HEAD[n].before}" w:after="${HEAD[n].after}" w:line="${n === 1 ? 259 : 276}" w:lineRule="auto"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:sz w:val="${HEAD[n].pt * 2}"/><w:szCs w:val="${HEAD[n].pt * 2}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="210" w:line="389" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    hstyle(1) + hstyle(2) + hstyle(3) +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="12" w:color="999999"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:color w:val="555555"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>';
  const lvls = f => Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/>${f(i)}<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join("");
  const bullets = ["•", "◦", "▪"];
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(i => `<w:numFmt w:val="bullet"/><w:lvlText w:val="${bullets[i % 3]}"/>`)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(i => `<w:numFmt w:val="${["decimal", "lowerLetter", "lowerRoman"][i % 3]}"/><w:lvlText w:val="%${i + 1}."/>`)}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
    nums.map(n => `<w:num w:numId="${n}"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join("") + "</w:numbering>";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rIdS" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="${REL}/numbering" Target="numbering.xml"/>` +
    links.map((u, i) => `<Relationship Id="rIdL${i}" Type="${REL}/hyperlink" Target="${esc(u)}" TargetMode="External"/>`).join("") + "</Relationships>";
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return zip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`],
    ["word/document.xml", doc], ["word/styles.xml", styles], ["word/numbering.xml", numbering], ["word/_rels/document.xml.rels", rels]
  ]);
}

// ---------------------------------------------------------------- import: shared helpers
const wordsOf = ops => ops.reduce((n, o) => n + (typeof o.insert === "string" ? (o.insert.match(/\S+/g) || []).length : 0), 0);
function finish(ops, notes = []) {
  if (!ops.length || !(typeof ops[ops.length - 1].insert === "string" && ops[ops.length - 1].insert.endsWith("\n"))) ops.push({ insert: "\n" });
  return { ops, words: wordsOf(ops), notes };
}
const q = (el, ns, name) => el ? el.getElementsByTagNameNS(ns, name) : [];
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HIGHLIGHT = { yellow: "FFFF00", green: "00FF00", cyan: "00FFFF", magenta: "FF00FF", blue: "0000FF", red: "FF0000", darkBlue: "000080", darkCyan: "008080", darkGreen: "008000", darkMagenta: "800080", darkRed: "800000", darkYellow: "808000", darkGray: "808080", lightGray: "C0C0C0", black: "000000" };
const attr = (el, name) => el ? el.getAttributeNS(W, name) || el.getAttribute("w:" + name) : null;
const kid = (el, name) => { if (el) for (const c of el.children) if (c.localName === name && c.namespaceURI === W) return c; return null; };
const on = el => el && !/^(0|false|off|none)$/i.test(attr(el, "val") || "1");

// ---------------------------------------------------------------- import: .docx
async function docxToOps(buf) {
  const files = await unzip(buf);
  const text = async n => files.has(n) ? new TextDecoder().decode(await files.get(n)()) : null;
  const xml = s => new DOMParser().parseFromString(s, "application/xml");
  const docXml = await text("word/document.xml");
  if (!docXml) throw new Error("That doesn't look like a Word document (no word/document.xml).");
  const doc = xml(docXml);
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Couldn't read that Word document.");
  const stylesXml = await text("word/styles.xml"), numXml = await text("word/numbering.xml"), relsXml = await text("word/_rels/document.xml.rels");
  const styles = new Map(); let defRun = null;
  if (stylesXml) {
    const s = xml(stylesXml);
    defRun = kid(kid(kid(s.documentElement, "docDefaults"), "rPrDefault"), "rPr");
    for (const st of q(s, W, "style")) styles.set(attr(st, "styleId"), st);
  }
  const rels = new Map();
  if (relsXml) for (const r of xml(relsXml).getElementsByTagName("Relationship")) rels.set(r.getAttribute("Id"), r.getAttribute("Target"));
  const numFmt = new Map();               // "numId:ilvl" -> "bullet" | "ordered"
  if (numXml) {
    const n = xml(numXml), abs = new Map();
    for (const a of q(n, W, "abstractNum")) for (const l of q(a, W, "lvl")) abs.set(attr(a, "abstractNumId") + ":" + attr(l, "ilvl"), attr(kid(l, "numFmt"), "val"));
    for (const nm of q(n, W, "num")) {
      const aid = attr(kid(nm, "abstractNumId"), "val");
      for (let i = 0; i < 9; i++) numFmt.set(attr(nm, "numId") + ":" + i, abs.get(aid + ":" + i) === "bullet" ? "bullet" : "ordered");
    }
  }
  // style chain: oldest first
  const chain = id => { const out = []; for (let s = styles.get(id), n = 0; s && n < 12; s = styles.get(attr(kid(s, "basedOn"), "val")), n++) out.unshift(s); return out; };
  const props = (pPr, rPr, charStyle, paraStyleId) => {
    // returns resolved run props
    const p = { bold: false, italic: false, underline: false, strike: false, color: null, background: null, font: null, pt: null };
    const apply = r => {
      if (!r) return;
      let e;
      if ((e = kid(r, "b"))) p.bold = on(e);
      if ((e = kid(r, "i"))) p.italic = on(e);
      if ((e = kid(r, "u"))) p.underline = on(e);
      if ((e = kid(r, "strike")) || (e = kid(r, "dstrike"))) p.strike = on(e);
      if ((e = kid(r, "color"))) { const v = attr(e, "val"); p.color = v && v !== "auto" && /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toLowerCase() : null; }
      if ((e = kid(r, "highlight"))) { const v = HIGHLIGHT[attr(e, "val")]; p.background = v ? "#" + v.toLowerCase() : null; }
      if ((e = kid(r, "shd"))) { const v = attr(e, "fill"); if (v && v !== "auto" && !/^f{6}$/i.test(v)) p.background = "#" + v.toLowerCase(); }
      if ((e = kid(r, "sz"))) p.pt = Number(attr(e, "val")) / 2;
      if ((e = kid(r, "rFonts"))) p.font = attr(e, "ascii") || attr(e, "hAnsi") || p.font;
    };
    apply(defRun);
    for (const s of chain(paraStyleId)) apply(kid(s, "rPr"));
    for (const s of chain(charStyle)) apply(kid(s, "rPr"));
    apply(rPr);
    return p;
  };
  const body = kid(doc.documentElement, "body");
  const paras = [];                       // { runs: [{text, p, link}], head, align, list, indent, quote }
  let images = 0, ignored = 0;
  const walk = el => {
    for (const c of el.children) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === "p") paras.push(readPara(c));
      else if (c.localName === "tbl" || c.localName === "tr" || c.localName === "tc" || c.localName === "sdt" || c.localName === "sdtContent") walk(c);
    }
  };
  const readPara = p => {
    const pPr = kid(p, "pPr"), sid = attr(kid(pPr, "pStyle"), "val");
    const out = { runs: [], head: 0, align: null, list: null, indent: 0, quote: false, sid };
    const sname = (attr(kid(styles.get(sid), "name"), "val") || sid || "").toLowerCase();
    const ol = [...chain(sid).map(s => kid(kid(s, "pPr"), "outlineLvl")), kid(pPr, "outlineLvl")].filter(Boolean).pop();
    const hm = /^heading\s*(\d)/.exec(sname);
    if (sname === "title") out.head = 1;
    else if (hm) out.head = Math.min(3, Number(hm[1]));
    else if (ol && Number(attr(ol, "val")) < 3) out.head = Number(attr(ol, "val")) + 1;
    if (/quote/.test(sname)) out.quote = true;
    const merged = [...chain(sid).map(s => kid(s, "pPr")), pPr].filter(Boolean);
    let jc = null, left = 0, numPr = null;
    for (const m of merged) {
      if (kid(m, "jc")) jc = attr(kid(m, "jc"), "val");
      if (kid(m, "ind")) left = Number(attr(kid(m, "ind"), "left") || attr(kid(m, "ind"), "start") || 0);
      if (kid(m, "numPr")) numPr = kid(m, "numPr");
      if (kid(m, "pBdr") && kid(kid(m, "pBdr"), "left")) out.quote = true;
    }
    out.align = { center: "center", right: "right", both: "justify", justify: "justify", end: "right" }[jc] || null;
    if (numPr && attr(kid(numPr, "numId"), "val") !== "0") {
      const lvl = Number(attr(kid(numPr, "ilvl"), "val") || 0);
      out.list = numFmt.get(attr(kid(numPr, "numId"), "val") + ":" + lvl) || "bullet";
      out.indent = Math.min(5, lvl);
    } else if (left > 0 && !out.head) out.indent = out.quote ? 0 : Math.min(5, Math.round(left / 720));
    const run = (r, link) => {
      const props_ = props(pPr, kid(r, "rPr"), attr(kid(kid(r, "rPr"), "rStyle"), "val"), sid);
      for (const n of r.children) {
        if (n.namespaceURI !== W) continue;
        if (n.localName === "t") out.runs.push({ text: n.textContent, p: props_, link });
        else if (n.localName === "tab") out.runs.push({ text: "\t", p: props_, link });
        else if (n.localName === "br" || n.localName === "cr") out.runs.push({ text: "\n", p: props_, link });
        else if (n.localName === "drawing" || n.localName === "pict" || n.localName === "object") images++;
      }
    };
    const inline = el => {
      for (const c of el.children) {
        if (c.namespaceURI !== W) continue;
        if (c.localName === "r") run(c, null);
        else if (c.localName === "hyperlink") {
          const id = c.getAttributeNS(R, "id") || c.getAttribute("r:id"), target = id ? rels.get(id) : null;
          const link = target && /^(https?:|mailto:)/i.test(target) ? target : null;
          for (const r of c.children) if (r.localName === "r") run(r, link);
        } else if (c.localName === "ins" || c.localName === "smartTag" || c.localName === "sdt" || c.localName === "sdtContent" || c.localName === "fldSimple") inline(c);
      }
    };
    inline(p);
    return out;
  };
  walk(body);
  // the body size: the most common run size, so "large" and "small" mean something in this document
  const tally = new Map();
  for (const pa of paras) if (!pa.head) for (const r of pa.runs) if (r.p.pt) tally.set(r.p.pt, (tally.get(r.p.pt) || 0) + r.text.length);
  let base = 12, best = 0;
  for (const [pt, n] of tally) if (n > best) { best = n; base = pt; }
  const sizeOf = pt => !pt ? null : pt <= base * 0.85 ? "small" : pt >= base * 2 ? "huge" : pt >= base * 1.35 ? "large" : null;
  const ops = [];
  for (const pa of paras) {
    const hasText = pa.runs.some(r => r.text);
    // a manual line break splits the paragraph in two
    for (const r of pa.runs) {
      const parts = r.text.split("\n");
      parts.forEach((t, i) => {
        if (t) {
          const a = {};
          if (r.p.bold && !pa.head) a.bold = true;
          if (r.p.italic) a.italic = true;
          if (r.p.underline && !r.link) a.underline = true;
          if (r.p.strike) a.strike = true;
          if (r.p.color && r.p.color !== "#000000" && !r.link && !pa.head && !(pa.quote && r.p.color === "#555555")) a.color = r.p.color;
          if (r.p.background) a.background = r.p.background;
          if (r.p.font && /comic/i.test(r.p.font)) a.font = "comic";
          const s = pa.head ? null : sizeOf(r.p.pt); if (s) a.size = s;
          if (r.link) a.link = r.link;
          ops.push(Object.keys(a).length ? { insert: t, attributes: a } : { insert: t });
        }
        if (i < parts.length - 1) ops.push({ insert: "\n", attributes: lineAttrs(pa) });
      });
    }
    ops.push({ insert: "\n", attributes: lineAttrs(pa) });
    void hasText;
  }
  const notes = [];
  if (images) notes.push(`${images} picture${images === 1 ? " was" : "s were"} left out (pictures can only be added from a link).`);
  if (!paras.length) throw new Error("That Word document looks empty.");
  void ignored;
  return finish(clean(ops), notes);
}
function lineAttrs(pa) {
  const a = {};
  if (pa.head) a.header = pa.head;
  if (pa.list) { a.list = pa.list; if (pa.indent) a.indent = pa.indent; }
  else if (pa.quote && !pa.head) a.blockquote = true;
  else if (pa.indent) a.indent = pa.indent;
  if (pa.align && !pa.list) a.align = pa.align;
  return Object.keys(a).length ? a : undefined;
}
function clean(ops) {                    // drop attributes: undefined, merge neighbouring runs that look the same
  const out = [];
  for (const o of ops) {
    if (!o.attributes) delete o.attributes;
    const last = out[out.length - 1];
    if (last && o.insert !== "\n" && last.insert !== "\n" && JSON.stringify(last.attributes || null) === JSON.stringify(o.attributes || null)) last.insert += o.insert;
    else out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------- import: .txt
function txtToOps(buf) {
  let s;
  const b = new Uint8Array(buf);
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { s = new TextDecoder("windows-1252").decode(b); }
  s = s.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n").replace(/\u00A0/g, " ");
  return finish([{ insert: s.endsWith("\n") ? s : s + "\n" }]);
}

// ---------------------------------------------------------------- import: .pages
// Pages (2013 and later) keeps its text in "Index/*.iwa": snappy-compressed protobuf. Only the text is read;
// Pages doesn't keep its formatting where a browser can reach it. (Pages '09 files, with index.xml, are read too.)
function snappy(src) {                    // raw snappy block
  let p = 0, len = 0, shift = 0;
  for (; ;) { const c = src[p++]; len |= (c & 127) << shift; if (!(c & 128)) break; shift += 7; }
  const out = new Uint8Array(len);
  let o = 0;
  while (p < src.length && o < len) {
    const tag = src[p++], t = tag & 3;
    if (t === 0) {
      let n = tag >> 2;
      if (n >= 60) { const k = n - 59; n = 0; for (let i = 0; i < k; i++) n |= src[p++] << (8 * i); }
      n += 1;
      out.set(src.subarray(p, p + n), o); p += n; o += n;
    } else {
      let n, off;
      if (t === 1) { n = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | src[p++]; }
      else if (t === 2) { n = (tag >> 2) + 1; off = src[p] | (src[p + 1] << 8); p += 2; }
      else { n = (tag >> 2) + 1; off = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24); p += 4; }
      for (let i = 0; i < n; i++, o++) out[o] = out[o - off];
    }
  }
  return out;
}
function iwaUnpack(b) {                   // chunks: 0x00 + 3-byte length + snappy data
  const parts = []; let p = 0, total = 0;
  while (p + 4 <= b.length && b[p] === 0) {
    const n = b[p + 1] | (b[p + 2] << 8) | (b[p + 3] << 16);
    const d = snappy(b.subarray(p + 4, p + 4 + n));
    parts.push(d); total += d.length; p += 4 + n;
  }
  const out = new Uint8Array(total); let o = 0;
  for (const d of parts) { out.set(d, o); o += d.length; }
  return out;
}
function varint(b, p) { let v = 0, m = 1; for (; ;) { const c = b[p.i++]; v += (c & 127) * m; if (!(c & 128)) return v; m *= 128; if (m > 2 ** 49) return v; } }
function fields(b) {                      // protobuf message -> [{f, w, v | bytes}]
  const out = [], p = { i: 0 };
  try {
    while (p.i < b.length) {
      const k = varint(b, p), f = Math.floor(k / 8), w = k % 8;
      if (w === 0) out.push({ f, w, v: varint(b, p) });
      else if (w === 2) { const n = varint(b, p); out.push({ f, w, bytes: b.subarray(p.i, p.i + n) }); p.i += n; }
      else if (w === 1) p.i += 8;
      else if (w === 5) p.i += 4;
      else break;
    }
  } catch { /* a malformed tail is ignored */ }
  return out;
}
function iwaTexts(b) {                    // the text of every TSWP.StorageArchive (message type 2001) in an .iwa
  const data = iwaUnpack(b), texts = [];
  let p = { i: 0 };
  while (p.i < data.length) {
    const n = varint(data, p);
    const info = fields(data.subarray(p.i, p.i + n)); p.i += n;
    for (const m of info.filter(x => x.f === 2 && x.w === 2).map(x => fields(x.bytes))) {
      const type = (m.find(x => x.f === 1) || {}).v, len = (m.find(x => x.f === 3) || {}).v || 0;
      const msg = data.subarray(p.i, p.i + len); p.i += len;
      if (type === 2001) for (const f of fields(msg)) if (f.f === 3 && f.w === 2) texts.push(new TextDecoder().decode(f.bytes));
    }
  }
  return texts;
}
async function pagesToOps(buf) {
  const files = await unzip(buf);
  const names = [...files.keys()];
  let paragraphs = null;
  const iwa = names.filter(n => /^Index\/.*\.iwa$/i.test(n));
  if (iwa.length) {
    const texts = [];
    for (const n of iwa) texts.push(...iwaTexts(await files.get(n)()));
    const body = texts.sort((a, b) => b.length - a.length)[0];   // the document body is its longest text
    if (body) paragraphs = body;
  } else if (files.has("index.xml") || files.has("index.xml.gz")) {
    if (files.has("index.xml")) {
      const x = new DOMParser().parseFromString(new TextDecoder().decode(await files.get("index.xml")()), "application/xml");
      const ps = [...x.getElementsByTagName("*")].filter(e => e.localName === "p" && e.namespaceURI && /sf$|sfa?$|appleiwork|2008\/sf/.test(e.namespaceURI + "sf"));
      paragraphs = ps.map(e => [...e.getElementsByTagName("*")].filter(t => t.localName === "t" || t.localName === "span").length ? e.textContent : e.textContent).join("\n");
    }
  }
  if (paragraphs == null) throw new Error("Couldn't find any text in that Pages file. In Pages, choose File ▸ Export To ▸ Word (or Plain Text), then import that.");
  const s = paragraphs.replace(/\r\n?/g, "\n").replace(/[\u2029]/g, "\n").replace(/\u2028/g, "\n").replace(/[\uFFFC\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const res = finish([{ insert: s.endsWith("\n") ? s : s + "\n" }], ["Pages keeps its formatting out of reach for a browser, so only the text came across. Export from Pages as Word to keep bold, sizes and fonts."]);
  return res;
}

// ---------------------------------------------------------------- the entry point
export async function importFile(file) {
  const name = (file.name || "").toLowerCase();
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0)
    throw new Error("That's an old Word (.doc) file, which a browser can't read. In Word choose File ▸ Save As ▸ Word Document (.docx), then import that.");
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (/\.docx?$|\.dotx$/.test(name) || (isZip && !/\.pages$/.test(name) && !/\.txt$/.test(name))) {
    if (!isZip) throw new Error("That file isn't a .docx Word document.");
    const files = await unzip(buf);
    if (files.has("word/document.xml")) return docxToOps(buf);
    if (/\.pages$/.test(name)) return pagesToOps(buf);
    throw new Error("That file isn't a Word document.");
  }
  if (/\.pages$/.test(name)) return pagesToOps(buf);
  if (/\.rtf$/.test(name) || new TextDecoder().decode(head).startsWith("{\\rtf"))
    throw new Error("RTF files can't be read here. Save or export it as .docx (or paste the text straight into the editor), then import that.");
  if (/\.html?$/.test(name)) {                       // the editor turns HTML into formatted text
    const html = new TextDecoder().decode(buf);
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent || "";
    return { html, ops: null, words: (text.match(/\S+/g) || []).length, notes: ["Bold, italics, headings, lists, colours and links from the HTML came across. Page layout and spacing come from the wiki's own style."] };
  }
  if (/\.(txt|text|md|markdown)$/.test(name) || !isZip) return txtToOps(buf);
  throw new Error("That file type isn't supported. Use .docx, .pages or .txt.");
}

export const IMPORT_ACCEPT = ".docx,.doc,.pages,.txt,.text,.md,.html,.htm";
