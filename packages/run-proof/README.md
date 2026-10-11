# Momentum run proof

Private, dependency-free text extraction shared by Momentum's mobile and Discord adapters. This package reads OCR text; it does not recognize images or verify a run's authenticity.

`suggestRunProofFields(text)` returns optional `distanceKm` and `runDate` suggestions. It accepts one distinct positive kilometer distance, up to 500 km and two decimal places, and one distinct valid full date. Supported full dates are ISO, English month-name dates with a year, and slash dates whose day/month order is unambiguous. Conflicting or invalid candidates omit that field. Relative dates, yearless dates, and unsupported distance units are not inferred. An explicit full date takes precedence over relative labels. Every suggestion requires the user's review before saving.

`extractRunProofFields(text, options)` retains the Discord adapter's existing extraction behavior, including its explicit date precedence and caller-supplied year/date fallbacks.

The canonical source is `packages/run-proof/index.ts` in `runner-challenger`, extracted from its `src/services/runProofExtraction.ts`. Build and package with `npm pack ./packages/run-proof --pack-destination <app>/vendor`; the standard prepack hook uses the repository's TypeScript compiler. Consume the generated archive as a normal `file:` dependency with lockfile integrity. Do not edit an installed copy or the archive.

This is private Momentum source. No redistribution license is granted (`UNLICENSED`).
