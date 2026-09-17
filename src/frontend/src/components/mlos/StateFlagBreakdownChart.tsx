// Superseded by FlagBreakdownChart.tsx and never actually imported by
// MlosQcPage.tsx to begin with (this component predates /qc/validation
// dropping its single `state` param — see api/client.ts::submitMlosQC — and
// was written for a per-state breakdown that, at the time, could only ever
// render one bar). FlagBreakdownChart.tsx now covers the state level too,
// with real drill-down into LGA and ward. Stubbed rather than deleted — no
// file-delete tool available in this environment; nothing imports this file.
export {}
