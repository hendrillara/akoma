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
// It fails closed: bytes the parser leaves outside its tree (a tag cut off by the end of the page, attributes on an
// end tag), a body that is not windows-1252 or UTF-8 text (NUL bytes, a UTF-16 byte-order mark), a node without a
// source location, or a result that is not a fixpoint of the redaction throw `RedactionError`, so nothing from the page
// is kept: the daily job fails into its failure issue instead. Only a known JSON endpoint's body that parses as JSON
// (normas.leg.br's API) is passed through unread; any other body, whatever it starts with, is redacted as HTML.
// The daily job and the recheck wrap every source in `redacting`, so the build, the review, the committed capture and
// every report see the same redacted page, and a regeneration from the capture reads exactly what the run read.
import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Probe, RawSnapshot, Source, Validators } from "./source.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

/** The endpoints that serve JSON (review layer 2's normas.leg.br reader), whose bodies are not HTML. */
const JSON_ENDPOINTS = ["https://normas.leg.br/api/"];
/** Tokenizer errors after which bytes of the page are in no node of the tree, so no edit could reach them. */
const UNREPRESENTED = new Set(["eof-in-tag", "end-tag-with-attributes", "unexpected-null-character"]);

/** The page could not be redacted with certainty; its message names only the page, never its content. */
export class RedactionError extends Error {
  override name = "RedactionError";
}

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
 * An HTML page with its metadata redacted, byte for byte elsewhere: the bytes are read as latin1, which maps each byte
 * to one character, so offsets are byte offsets and any encoding round-trips (markup is ASCII in windows-1252 and UTF-8
 * alike, so parse5 finds the same tags in the latin1 reading as in the decoded page). Idempotent: a redacted page comes
 * back unchanged, and the result is checked to be one. Throws `RedactionError` rather than return a page it is not sure
 * of (see the header).
 */
export function redactPersonalData(body: Uint8Array): Uint8Array {
  if (!(body instanceof Uint8Array)) throw new RedactionError("redact: the body is not bytes");
  // The same page is often redacted again (every run of the job reads the same captures): reuse the result by content.
  const key = createHash("sha256").update(body).digest("hex");
  const known = DONE.get(key);
  if (known) return known === SAME ? body : known;
  const out = redactOnce(body);
  if (DONE.size >= 64) DONE.delete(DONE.keys().next().value!);
  DONE.set(key, out === body ? SAME : out);
  return out;
}

/** Results by the SHA-256 of the page, oldest first; `SAME` when the page needed no edit. */
const DONE = new Map<string, Uint8Array>();
const SAME = new Uint8Array(0);

function redactOnce(body: Uint8Array): Uint8Array {
  if (body.includes(0) || (body[0] === 0xfe && body[1] === 0xff) || (body[0] === 0xff && body[1] === 0xfe)) {
    throw new RedactionError("redact: the body is not windows-1252 or UTF-8 text (NUL bytes or a UTF-16 byte-order mark)");
  }
  const text = Buffer.from(body).toString("latin1");
  const changed = edits(text);
  if (!changed.length) return body;
  let out = "";
  let at = 0;
  for (const edit of changed) {
    if (edit.start < at) throw new RedactionError("redact: overlapping edits");
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  out += text.slice(at);
  // The redacted page must be a fixpoint: one more pass would change nothing.
  if (edits(out).length) throw new RedactionError("redact: the redacted page still has something to redact");
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** The edits a page needs, in page order: none for a page already redacted. */
function edits(text: string): Edit[] {
  const context: Context = { text, repaired: [], edits: [] };
  const document = parse(text, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (UNREPRESENTED.has(error.code)) throw new RedactionError(`redact: bytes the parser keeps in no node (${error.code} at offset ${error.startOffset})`);
      if (error.code === "duplicate-attribute") context.repaired.push(error.startOffset);
    },
  });
  walk(document, context, false);
  return context.edits.filter((e) => text.slice(e.start, e.end) !== e.text).sort((a, b) => a.start - b.start);
}

function walk(node: Node, context: Context, inXml: boolean): void {
  if (node.nodeName === "#comment") {
    context.edits.push({ ...located(node), text: "<!---->" });
    return;
  }
  if (node.nodeName === "#documentType") {
    const doctype = node as DefaultTreeAdapterMap["documentType"];
    if (!isStandardDoctype(doctype)) context.edits.push({ ...located(node), text: "<!DOCTYPE html>" });
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
  if (!at?.startTag) throw new RedactionError(`redact: a <${element.tagName}> without a source location`);
  if (at.endTag) return { start: at.startTag.endOffset, end: at.endTag.startOffset };
  return toEnd ? { start: at.startTag.endOffset, end: at.endOffset } : undefined;
}

/** A `<meta>` or `<link>` kept as served when it is known to be harmless, else replaced by a fixed tag. */
function startTagEdit(element: Element, { text, repaired }: Context): Edit | undefined {
  const tag = element.sourceCodeLocation?.startTag;
  if (!tag) throw new RedactionError(`redact: a <${element.tagName}> without a source location`);
  const wasRepaired = repaired.some((offset) => offset >= tag.startOffset && offset < tag.endOffset);
  const harmless = element.tagName === "meta" ? isCharsetDeclaration(element) : isStyleLink(element);
  if (harmless && !wasRepaired) return undefined;
  const close = text.slice(tag.startOffset, tag.endOffset).endsWith("/>") ? "/>" : ">";
  return { start: tag.startOffset, end: tag.endOffset, text: element.tagName === "meta" ? `<meta content="[redacted]"${close}` : `<link${close}` };
}

/** Where a comment or doctype sits in the page; every node read from the page has a location. */
function located(node: Node): { start: number; end: number } {
  const at = (node as DefaultTreeAdapterMap["commentNode"]).sourceCodeLocation;
  if (!at) throw new RedactionError(`redact: a ${node.nodeName} without a source location`);
  return { start: at.startOffset, end: at.endOffset };
}

/** `<!DOCTYPE html>` or a W3C public identifier with a w3.org system identifier: nothing that could hold a name. */
function isStandardDoctype({ name, publicId, systemId }: DefaultTreeAdapterMap["documentType"]): boolean {
  return (
    /^html$/i.test(name) &&
    (publicId === "" || /^-\/\/W3C\/\/DTD [\w .\/-]{1,60}\/\/EN$/.test(publicId)) &&
    (systemId === "" || /^https?:\/\/www\.w3\.org\/[\w.\/-]{1,100}$/.test(systemId))
  );
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

/**
 * A snapshot as the rest of the job may see it. A body from a known JSON endpoint passes through only when it is JSON
 * (no HTML media type, and it parses); every other body is redacted as HTML, whatever its first bytes are.
 */
export function redactSnapshot(snapshot: RawSnapshot): RawSnapshot {
  if (snapshot.encoding !== "utf-8" && snapshot.encoding !== "windows-1252") throw new RedactionError(`redact: ${snapshot.url}: unknown encoding`);
  if (JSON_ENDPOINTS.some((prefix) => snapshot.url.startsWith(prefix)) && isJson(snapshot)) return snapshot;
  try {
    return { ...snapshot, body: redactPersonalData(snapshot.body) };
  } catch (error) {
    // Only our own fixed messages, and the URL: never the page's bytes.
    const reason = error instanceof RedactionError ? error.message.replace(/^redact: /, "") : "the redactor failed";
    throw new RedactionError(`redact: ${snapshot.url}: ${reason}; nothing from this page is kept`);
  }
}

function isJson(snapshot: RawSnapshot): boolean {
  if (snapshot.contentType !== undefined && !/^application\/(?:[\w.+-]+\+)?json$/.test(snapshot.contentType)) return false;
  try {
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.body));
    return true;
  } catch {
    return false;
  }
}

/** `source` with `redactSnapshot` applied to every page it serves (once per body: a source may serve one twice). */
export function redacting(source: Source): Source {
  const done = new WeakMap<Uint8Array, RawSnapshot>();
  const clean = (snapshot: RawSnapshot): RawSnapshot => {
    const known = done.get(snapshot.body);
    if (known && known.url === snapshot.url) return { ...snapshot, body: known.body };
    const redacted = redactSnapshot(snapshot);
    done.set(snapshot.body, redacted);
    return redacted;
  };
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
