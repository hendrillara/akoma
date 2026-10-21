// Personal data in page metadata never gets past the source. Document properties can name a person (on Câmara LEGIN
// pages, the staff member who edited the file), so instead of hunting for names the redactor keeps only what is known
// to be harmless and blanks the rest of every place where metadata lives:
// - every `<meta>` but a charset declaration (a known charset label, nothing else) becomes `<meta content="[redacted]">`;
// - every `<link>` but a plain stylesheet or icon link becomes `<link>`;
// - every HTML comment becomes `<!---->` (Word's conditional comments hold its document properties; a CDATA section
//   or a `<?…?>`/`<![…]>` block in HTML is a comment too);
// - the content of every raw-text or RCDATA element (`script`, `style`, `title`, `textarea`, `xmp`, `iframe`,
//   `noembed`, `noframes`, `noscript`), of every `<template>`, of every Office XML island (`<xml>`,
//   `<o:DocumentProperties>`) and of every Office property element (`o:*` but `<o:p>`, `dc:*`, `dcterms:*`, `cp:*`) is
//   removed.
// The page is read with parse5, the parser the build reads it with, and every edit is made at parse5's source
// locations, so the redactor sees exactly the elements, attributes and comments the build does: a `>` inside a quoted
// value, an attribute name written with a character reference, a repeated attribute or markup inside raw text cannot
// put a value where one reader sees it and the other does not. The build's own text is untouched: it never reads
// `<head>`, scripts, styles or templates, and the law is never inside a comment, a meta or an Office property element.
// One limit, on pages the build could not read either: an element that swallows the rest of the page (`<plaintext>`,
// or a `<title>`/`<textarea>`… never closed) keeps that text, which the build reads as the page's text.
// The daily job and the recheck wrap every source in `redacting`, so the build, the review, the committed capture and
// every report see the same redacted page, and a regeneration from the capture reads exactly what the run read.
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Probe, RawSnapshot, Source, Validators } from "./source.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/** Elements whose content the tokenizer reads as raw text or RCDATA (no tags, no comments inside). */
const RAW_TEXT = new Set(["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes", "noscript"]);
/** Of those, the ones the build never reads: blanked to the end of the page when they are never closed. */
const NEVER_READ = new Set(["script", "style"]);
/** Office's document-property namespaces (Word HTML, OOXML core properties). `o:p` is Word's paragraph, kept. */
const OFFICE_PREFIX = /^(?:o|dc|dcterms|cp):/;
const CHARSET_LABEL = "(?:utf-?8|windows-125[0-8]|iso-8859-(?:1|15)|us-ascii|latin1)";
const CHARSET = new RegExp(`^${CHARSET_LABEL}$`, "i");
const CONTENT_TYPE = new RegExp(`^text/html\\s*(?:;\\s*charset\\s*=\\s*${CHARSET_LABEL}\\s*)?$`, "i");
const LINK_RELS = new Set(["stylesheet", "icon", "shortcut icon"]);

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Context {
  text: string;
  /** Offsets of the start tags the parser had to repair (a repeated attribute, which it drops but the bytes keep). */
  repaired: number[];
  edits: Edit[];
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

  const context: Context = { text, repaired: [], edits: [] };
  const document = parse(text, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (error.code === "duplicate-attribute") context.repaired.push(error.startOffset);
    },
  });
  walk(document, context, false);

  const changed = context.edits.filter((e) => text.slice(e.start, e.end) !== e.text).sort((a, b) => a.start - b.start);
  if (!changed.length) return body;
  let out = "";
  let at = 0;
  for (const edit of changed) {
    if (edit.start < at) throw new Error("redact: overlapping edits");
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return new Uint8Array(Buffer.from(out + text.slice(at), "latin1"));
}

function walk(node: Node, context: Context, inXml: boolean): void {
  if (node.nodeName === "#comment") {
    const at = (node as DefaultTreeAdapterMap["commentNode"]).sourceCodeLocation;
    if (at) context.edits.push({ start: at.startOffset, end: at.endOffset, text: "<!---->" });
    return;
  }
  if (!("tagName" in node)) {
    if ("childNodes" in node) for (const child of node.childNodes) walk(child, context, inXml);
    return;
  }
  const element = node as Element;
  const name = element.tagName;
  if (name === "meta" || name === "link") {
    const edit = startTagEdit(element, context);
    if (edit) context.edits.push(edit);
    return;
  }
  const blanked =
    RAW_TEXT.has(name) ||
    name === "template" ||
    name === "xml" ||
    /:(?:custom)?documentproperties$/.test(name) ||
    (OFFICE_PREFIX.test(name) && name !== "o:p") ||
    // Inside an `<xml>` the page never closes, every namespaced element is Office's.
    (inXml && name.includes(":") && name !== "o:p");
  if (blanked) {
    const inner = innerSpan(element, NEVER_READ.has(name));
    if (inner) {
      context.edits.push({ ...inner, text: "" });
      return;
    }
  }
  const children = name === "template" ? (element as DefaultTreeAdapterMap["template"]).content.childNodes : element.childNodes;
  for (const child of children) walk(child, context, inXml || name === "xml");
}

/**
 * Between the start tag and the end tag. An element the page never closes runs to the end of what the parser gave it:
 * blanked that far only when the build never reads it (`toEnd`), else `undefined` (its children are walked instead).
 */
function innerSpan(element: Element, toEnd: boolean): { start: number; end: number } | undefined {
  const at = element.sourceCodeLocation;
  if (!at?.startTag) return undefined;
  if (at.endTag) return { start: at.startTag.endOffset, end: at.endTag.startOffset };
  return toEnd ? { start: at.startTag.endOffset, end: at.endOffset } : undefined;
}

/** A `<meta>` or `<link>` kept as served when it is known to be harmless, else replaced by a fixed tag. */
function startTagEdit(element: Element, { text, repaired }: Context): Edit | undefined {
  const tag = element.sourceCodeLocation?.startTag;
  if (!tag) return undefined;
  const wasRepaired = repaired.some((offset) => offset >= tag.startOffset && offset < tag.endOffset);
  const harmless = element.tagName === "meta" ? isCharsetDeclaration(element) : isStyleLink(element);
  if (harmless && !wasRepaired) return undefined;
  const close = text.slice(tag.startOffset, tag.endOffset).endsWith("/>") ? "/>" : ">";
  return { start: tag.startOffset, end: tag.endOffset, text: element.tagName === "meta" ? `<meta content="[redacted]"${close}` : `<link${close}` };
}

/** `<meta charset="utf-8">` or `<meta http-equiv="Content-Type" content="text/html; charset=…">`, and nothing else. */
function isCharsetDeclaration(element: Element): boolean {
  const attributes = new Map(element.attrs.map((a) => [a.name, a.value.trim()]));
  const names = [...attributes.keys()].sort().join(" ");
  if (names === "charset") return CHARSET.test(attributes.get("charset")!);
  if (names === "content http-equiv") {
    return attributes.get("http-equiv")!.toLowerCase() === "content-type" && CONTENT_TYPE.test(attributes.get("content")!);
  }
  return false;
}

/** A stylesheet or icon link: `rel`, `href` and optionally `type`/`media`, with nothing that could hold a name. */
function isStyleLink(element: Element): boolean {
  const attributes = new Map(element.attrs.map((a) => [a.name, a.value.trim()]));
  if ([...attributes.keys()].some((n) => !["rel", "href", "type", "media"].includes(n))) return false;
  const rel = attributes.get("rel")?.toLowerCase().replace(/\s+/g, " ");
  const type = attributes.get("type");
  const media = attributes.get("media");
  return (
    rel !== undefined &&
    LINK_RELS.has(rel) &&
    /^[\w./-]{1,200}$/.test(attributes.get("href") ?? "") &&
    (type === undefined || /^[\w.+-]+\/[\w.+-]+$/.test(type)) &&
    (media === undefined || /^[\w ,():.-]{1,60}$/.test(media))
  );
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
