# Parser hygiene fixture

`page.htm` is a small Planalto-style page, stored as windows-1252 bytes with no charset declared, like the real pages. It exercises every markup variant the parser must handle through seam 1, including the ones the compiled CF page lacks (items, vetoed dispositivos, `<s>`, `<del>`, CSS line-through, Parte/Livro headings). Its `url` is under `example.invalid`, so it can never be mistaken for an official source.

How it was made: written as UTF-8 (`page.utf8.htm`, kept for editing), then converted with `iconv -f UTF-8 -t WINDOWS-1252 page.utf8.htm > page.htm`; its SHA-256 and size are in `index.json`. To change it, edit `page.utf8.htm`, reconvert, and update the checksum and size.

Where each part comes from (all Planalto pages, public domain; edits are listed):

- **Arts. 1º–3º:** CDC (Lei 8.078/1990) arts. 1º–3º. Edits: art. 2º's ordinal written as `<sup><u>o</u></sup>` (the Código Civil's form) and § 2º's as `<sup>o</sup>`; art. 3º's text shortened, and an invented old wording struck before it (the full-history page's pattern); § 2º ends with a phrase struck with `<s>`; § 3º is `(Vetado).` (CDC style); § 4º is invented, prefixed with `<del>` and CSS line-through text, and uses `&#146;`, `&#147;`, `&#148;`; it is labelled `§ 4.º` (CF art. 103).
- **Art. 4º-A:** CDC art. 4º caput, inciso I and II (shortened), relabelled `4º-A` (the ordinal + letter form of CLT/CC), with a nested strike (`<strike>…<s>…</s>…</strike>`) before its text. Inciso I uses `&#150;`, inciso II a raw 0x96 byte. Alíneas a/b (one with no space after the parenthesis, as in CF art. 155) and itens 1/2 are invented to reach the item level. Inciso III repeats the full-history pattern (struck old wording, then the new one with an invented "Redação dada pela Lei nº 9.999, de 1999" link); IX is `(Vetado);`; § 1º-A is invented.
- **Art. 10-B:** CLT art. 482 caput and alíneas a/b (alíneas directly under the caput, dash after the number), renumbered `10-B`.
- **Art. 11:** CDC art. 11, `(Vetado).`
- **Closing:** the CDC's "Brasília, 11 de setembro de 1990; …" formula, then a signature and a line that looks like an inciso, which the parser must ignore.
- **Headings:** `PARTE GERAL` (CC) and `LIVRO PRIMEIRO` (CTN) above the CDC's TÍTULO I / CAPÍTULO I; CAPÍTULO II is invented. A `<script>` in the head stands for the token Planalto's WAF injects.

---

# Fixture de higiene do parser (PT)

`page.htm` é uma página pequena no estilo do Planalto, gravada em bytes windows-1252 sem charset declarado, como as páginas reais. Ela exercita pelo seam 1 cada variante de marcação que o parser precisa tratar, inclusive as que a CF compilada não tem (itens, dispositivos vetados, `<s>`, `<del>`, line-through via CSS, títulos de Parte/Livro). A `url` fica em `example.invalid`, para nunca ser confundida com uma fonte oficial.

Como foi feita: escrita em UTF-8 (`page.utf8.htm`, mantida para edição) e convertida com `iconv -f UTF-8 -t WINDOWS-1252 page.utf8.htm > page.htm`; o SHA-256 e o tamanho estão no `index.json`. Para alterá-la, edite `page.utf8.htm`, reconverta e atualize o checksum e o tamanho.

A origem de cada trecho e as edições feitas estão listadas na seção em inglês acima (todos de páginas do Planalto, de domínio público).
