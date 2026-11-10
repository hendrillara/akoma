# Licensing transition — 2026-11-10

## Approved terms

The maintainer requested publication of terms requiring royalties and attribution for future versions, then selected:

- A prior signed commercial agreement, with royalties negotiated per customer rather than a public percentage.
- Free personal use, education and research without a commercial purpose.
- The linked credit “Uses Akoma by Hendril Lara” / “Utiliza Akoma, de Hendril Lara” in a product credits/about page or integration documentation, including commercial products. Backend and internal tools use their consumer-facing/internal documentation.

`LICENSE` contains the operative English terms. `COMMERCIAL.md` explains the offer in Portuguese and English. This is a custom source-available licence, not an OSI-approved open-source licence. No lawyer review or guarantee of enforceability is represented. Commercial agreements must be completed and signed before commercial use of covered new material; royalty amounts and payment mechanics remain customer-specific.

## Boundary and actual effect of this release

Legacy baseline: `262e60ec8e9814ddaca1b9e81c9f63bb90b858e0` (PR #24 merge). Preserve its MIT notice verbatim in `licenses/MIT-legacy.txt`. The legacy dataset is `2026-10-21` under CC0 with the documented third-party exceptions.

This release adds licensing and commercial documentation only. It adds no new runtime capability and changes no generated legal data. Existing functionality can still be used under its prior terms. It would be misleading to claim that this release makes the already published runtime or dataset exclusive or automatically royalty-bearing.

New protectable original code/documentation after the baseline is covered by the new licence. Only the new protectable contributions in a modified legacy file are covered; unchanged portions retain their permissions. New original dataset contributions must be identified in release notes before publication. Facts, statutory text, mere format conversions/regeneration, previously CC0 material, third-party captures and Senado/LexML aliases are excluded. The current hosted API/MCP snapshot retains prior permissions; service authentication, billing and access terms are separate work.

## Ownership and contribution checks

The local history through the baseline lists 116 authored commits under Hendril Lara and no coauthor trailers were found. This is provenance evidence, not a legal ownership determination. Dependencies and third-party captures are excluded from the new licence and retain their terms; this change does not relicense or redistribute them under new terms.

Before publishing future material, confirm the rights to that specific contribution. For external contributions, obtain a written agreement permitting both the stated noncommercial distribution and commercial licensing by Hendril Lara before merge. A PR alone is not an assignment. Do not import third-party code under the proprietary scope without compatible rights and preserved notices.

## Publication and operations

Publish the boundary, licence and explanatory documents together. Do not rewrite history or remove the old notices. Keep `publish.yml` and `recheck.yml` disabled until the separate operational/source-freshness review and maintainer authorization described in `publishing.md`; the licensing publication is not authorization to restart dataset updates. Keep the existing hosted service accessible. No collection of money, customer contract or outreach message is performed by publishing these terms.

Before each future release, identify newly covered contributions, legacy components, dataset rights and external permissions. Pricing and contractual royalty reporting are negotiated privately; do not place customer information in public GitHub issues.

## Resumo em português

Uso comercial das novas contribuições próprias exige contrato prévio, royalties negociados e menção ao Akoma. Uso pessoal, estudo e pesquisa sem finalidade comercial permanecem gratuitos sob as condições da licença. O marco `262e60e`, o dataset existente e os direitos de terceiros preservam seus termos. Esta versão publica as regras futuras; não adiciona funcionalidade exclusiva, não cobra automaticamente e não transforma o código antigo em material restrito. As atualizações automáticas continuam pausadas até revisão operacional e autorização de retomada.

## Primary references

- MIT grant: https://opensource.org/license/mit
- CC0 waiver and fallback: https://creativecommons.org/publicdomain/zero/1.0/legalcode.en
- Open-source definition: https://opensource.org/osd
