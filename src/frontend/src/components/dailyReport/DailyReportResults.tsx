// ORPHANED — no longer imported anywhere. DailyReportPage.tsx used to render
// this component with the ZIP-of-four-PNGs result api/parseResult.ts::
// parseDailyReportZip produced; POST /reports/daily was reworked
// server-side to return list[PostReport] JSON directly (the same contract
// POST /reports/post uses), so DailyReportPage.tsx now renders that
// straight through DailyReportGallery.tsx / DailyReportChartTable.tsx
// instead — the day/cumulative "tab" behaviour this file provided lives on
// as the Qualifier filter in those two components.
//
// Left as an inert stub rather than removed — this session cannot delete
// files on the linked device. Safe to delete by hand:
// src/frontend/src/components/dailyReport/DailyReportResults.tsx
export {}
