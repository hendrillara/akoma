// Personal data in page metadata never gets past the source. Document properties can name a person (on Câmara LEGIN
// pages, the staff member who edited the file), so the redactor keeps an allowlist instead of hunting for names: of the
// page's metadata, only the charset declaration stays as served. Every other `<meta>` keeps its key (name, property,
// itemprop, http-equiv), has its `content` replaced with "[redacted]" and loses any other attribute; every HTML
// comment (Word's conditional ones hold its document properties) is emptied; and every Office XML block (`<xml>`,
// `<o:DocumentProperties>`) loses its content. The page is read with parse5, the parser the build reads it with, so the redactor sees exactly the
// elements, attributes and comments the build would: no regex over markup, no parser differential.
// The daily job wraps every source in `redacting`, so the build, the review, the committed capture and every report
// see the same redacted page, and a regeneration from the capture reads exactly what the run read.
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Probe, RawSnapshot, Source, Validators } from "./source.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

const REDACTED = "[redacted]";
/** The attributes that say what a meta is: kept as written. `content` becomes "[redacted]"; any other attribute is dropped. */
const META_KEYS = new Set(["name", "property", "itemprop", "http-equiv"]);
/** A charset declaration's values, when they are nothing but that. */
const CHARSET = /^[\w.:-]{1,40}$/;
const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+\s*(?:;\s*charset\s*=\s*[\w.:-]{1,40}\s*)?$/i;

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * The page with its metadata redacted, byte for byte elsewhere: the bytes are read as latin1, which maps each byte to
 * one character, so offsets are byte offsets and any encoding round-trips (markup is ASCII in windows-1252 and UTF-8
 * alike, so parse5 finds the same tags in the latin1 reading as in the decoded page). A JSON body is left alone.
 * Idempotent: a redacted page comes back unchanged.
 */
export function redactPersonalData(body: Uint8Array): Uint8Array {
  const text = Buffer.from(body).toString("latin1");
  if (/^\s*[[{]/.test(text)) return body;

  // Start tags the parser had to repair (a repeated attribute, which it drops but the bytes keep).
  const repaired: number[] = [];
  const document = parse(text, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (error.code === "duplicate-attribute") repaired.push(error.startOffset);
    },
  });
  const edits: Edit[] = [];
  walk(document, text, repaired, edits);
  if (!edits.length) return body;

  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const edit of edits) {
    if (edit.start < at) throw new Error("redact: overlapping edits");
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  out += text.slice(at);
  return out === text ? body : new Uint8Array(Buffer.from(out, "latin1"));
}

function walk(node: Node, text: string, repaired: number[], edits: Edit[], inXml = false): void {
  if (node.nodeName === "#comment") {
    const at = (node as DefaultTreeAdapterMap["commentNode"]).sourceCodeLocation;
    if (at && text.slice(at.startOffset, at.endOffset) !== "<!---->") edits.push({ start: at.startOffset, end: at.endOffset, text: "<!---->" });
    return;
  }
  if (!("tagName" in node)) {
    if ("childNodes" in node) for (const child of node.childNodes) walk(child, text, repaired, edits, inXml);
    return;
  }
  const element = node as Element;
  if (element.tagName === "meta") {
    const edit = metaEdit(element, text, repaired);
    if (edit) edits.push(edit);
    return;
  }
  // An `<xml>` the page never closes swallows what follows, which the build reads as text too: then only the Office
  // elements inside it are emptied.
  if (isOfficeBlock(element) || (inXml && element.tagName.includes(":") && element.tagName !== "o:p")) {
    const inner = innerSpan(element);
    if (inner) {
      if (inner.end > inner.start) edits.push({ ...inner, text: "" });
      return;
    }
  }
  const children = element.tagName === "template" ? (element as DefaultTreeAdapterMap["template"]).content.childNodes : element.childNodes;
  for (const child of children) walk(child, text, repaired, edits, inXml || element.tagName === "xml");
}

/** `<xml>` (Word's data island) and the document-property elements Office writes, wherever they are. */
function isOfficeBlock(element: Element): boolean {
  return element.tagName === "xml" || /:(?:custom)?documentproperties$/.test(element.tagName);
}

/** Between the start tag and the end tag; `undefined` when the page does not close the element. */
function innerSpan(element: Element): { start: number; end: number } | undefined {
  const at = element.sourceCodeLocation;
  if (!at?.startTag || !at.endTag) return undefined;
  return { start: at.startTag.endOffset, end: at.endTag.startOffset };
}

/**
 * A charset declaration made of nothing else stays as served. Any other meta keeps its key attributes, gets
 * "[redacted]" as its `content` and loses its other attributes, in place; one whose start tag the parser repaired (a
 * repeated attribute) is written again from what the parser read.
 */
function metaEdit(element: Element, text: string, repaired: number[]): Edit | undefined {
  const tag = element.sourceCodeLocation?.startTag;
  const locations = element.sourceCodeLocation?.attrs;
  if (!tag) return undefined;
  const raw = text.slice(tag.startOffset, tag.endOffset);
  const wasRepaired = repaired.some((offset) => offset >= tag.startOffset && offset < tag.endOffset);
  if (!wasRepaired && isCharsetDeclaration(element)) return undefined;

  if (wasRepaired || !locations) {
    const attributes = element.attrs
      .filter((a) => META_KEYS.has(a.name) || a.name === "content")
      .map((a) => ` ${a.name}="${META_KEYS.has(a.name) ? escapeAttribute(a.value) : REDACTED}"`);
    return { start: tag.startOffset, end: tag.endOffset, text: `<meta${attributes.join("")}${raw.endsWith("/>") ? "/" : ""}>` };
  }
  // In place: the key attributes stay as written, `content` gets "[redacted]" in its own quotes, and any other
  // attribute goes with the space before it; everything else (case, spacing, "/") is kept.
  const spans: Edit[] = [];
  for (const attribute of element.attrs) {
    const at = locations[attribute.name];
    if (!at || META_KEYS.has(attribute.name)) continue;
    const start = at.startOffset - tag.startOffset;
    const end = at.endOffset - tag.startOffset;
    const written = raw.slice(start, end);
    if (attribute.name !== "content") {
      const space = /\s*$/.exec(raw.slice(0, start))![0].length;
      spans.push({ start: start - space, end, text: "" });
      continue;
    }
    const value = /^(\s*=\s*)(["']?)/.exec(written.slice(attribute.name.length));
    const name = written.slice(0, attribute.name.length);
    const replaced = value ? `${name}${value[1]}${value[2]}${REDACTED}${value[2]}` : `${name}="${REDACTED}"`;
    if (replaced !== written) spans.push({ start, end, text: replaced });
  }
  if (!spans.length) return undefined;
  let out = "";
  let at = 0;
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    out += raw.slice(at, span.start) + span.text;
    at = span.end;
  }
  return { start: tag.startOffset, end: tag.endOffset, text: out + raw.slice(at) };
}

function isCharsetDeclaration(element: Element): boolean {
  const attributes = new Map(element.attrs.map((a) => [a.name, a.value]));
  if ([...attributes.keys()].some((name) => !["charset", "http-equiv", "content"].includes(name))) return false;
  const charset = attributes.get("charset");
  if (charset !== undefined) return CHARSET.test(charset) && !attributes.has("content") && !attributes.has("http-equiv");
  return attributes.get("http-equiv")?.toLowerCase() === "content-type" && CONTENT_TYPE.test(attributes.get("content") ?? "");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** `source` with `redactPersonalData` applied to every page it serves. */
export function redacting(source: Source): Source {
  const clean = (snapshot: RawSnapshot): RawSnapshot => ({ ...snapshot, body: redactPersonalData(snapshot.body) });
  return {
    async get(url) {
      const snapshot = await source.get(url);
      return snapshot && clean(snapshot);
    },
    ...(source.probe && {
      async probe(url: string, validators: Validators): Promise<Probe> {
        const result = await source.probe!(url, validators);
        return result.status === "modified" ? { status: "modified", snapshot: clean(result.snapshot) } : result;
      },
    }),
  };
}
