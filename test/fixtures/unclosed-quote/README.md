# Unclosed-quote fixture

`page.htm` is CDC (Lei 8.078/1990) arts. 110–111 and its closing formula, taken from the 2026-10-20 Planalto capture, with one documented edit: the closing quote mark after "coletivo" in art. 110's quotation of Lei 7.347/1985 is removed. A quote that never closes would swallow the rest of the norm, so the build must fail instead. Made like the hygiene fixture: `page.utf8.htm` converted with `iconv -f UTF-8 -t WINDOWS-1252`, checksum and size in `index.json`.

---

# Fixture de aspas não fechadas (PT)

`page.htm` traz os arts. 110–111 do CDC (Lei 8.078/1990) e o fecho, tirados da captura do Planalto de 20/10/2026, com uma edição documentada: foi removida a aspa de fechamento depois de "coletivo" na citação da Lei 7.347/1985 pelo art. 110. Uma citação que nunca fecha engoliria o resto da norma, então o build precisa falhar. Feita como a fixture de higiene: `page.utf8.htm` convertido com `iconv -f UTF-8 -t WINDOWS-1252`, checksum e tamanho no `index.json`.
