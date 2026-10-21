// Personal data in page metadata never gets past the source: document properties that name a person (on Câmara LEGIN
// pages, the staff member who edited the file) are replaced with "[redacted]" before anything reads the bytes. The
// daily job wraps every source in `redacting`, so the build, the review, the committed capture and every report see
// the same redacted page, and a regeneration from the capture reads exactly what the run read.
import type { Probe, RawSnapshot, Source, Validators } from "./source.ts";

/** Document properties that hold a person's name, as `<meta name>` values and as Office XML elements. */
const PERSON_FIELDS = ["author", "changedby", "creator", "lastauthor", "last-author", "lastmodifiedby", "manager", "dc.creator", "dcterms.creator"];
const OFFICE_ELEMENTS = ["o:Author", "o:LastAuthor", "o:Manager", "dc:creator", "cp:lastModifiedBy"];

const ATTRIBUTE = /([^\s"'<>\/=]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g;
const unquote = (value: string) => value.replace(/^["']|["']$/g, "");

/**
 * The page with every person field's value replaced, byte for byte elsewhere: the bytes are read as latin1, which maps
 * each byte to one character, so any encoding round-trips. A JSON body is left alone.
 */
export function redactPersonalData(body: Uint8Array): Uint8Array {
  const text = Buffer.from(body).toString("latin1");
  if (/^\s*[[{]/.test(text)) return body;
  let edited = text.replace(/<meta\b[^>]*>/gi, (tag) => {
    const attributes = [...tag.matchAll(ATTRIBUTE)];
    const name = attributes.find((a) => a[1]!.toLowerCase() === "name");
    if (!name || !PERSON_FIELDS.includes(unquote(name[3]!).toLowerCase())) return tag;
    return tag.replace(ATTRIBUTE, (whole, attribute: string, eq: string, value: string) => {
      if (attribute.toLowerCase() !== "content") return whole;
      const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
      return `${attribute}${eq}${quote}[redacted]${quote}`;
    });
  });
  for (const element of OFFICE_ELEMENTS) {
    const pattern = new RegExp(`(<${element}\\b[^>]*>)[\\s\\S]*?(</${element}\\s*>)`, "gi");
    edited = edited.replace(pattern, "$1[redacted]$2");
  }
  return edited === text ? body : new Uint8Array(Buffer.from(edited, "latin1"));
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
