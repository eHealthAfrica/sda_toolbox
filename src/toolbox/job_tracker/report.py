import io
import os
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from reportlab.lib.colors import Color, HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas

from toolbox.job_tracker.classify import is_counted

# What this is: the downloadable PDF behind the Reliability page's "Download
# report" button (GET /jobs/report). It is a pure function of the numbers the
# page already shows: build_report_pdf() takes the dicts that stats.py,
# incidents.py, store.get_recent() and health.readiness() return and gives back
# PDF bytes. It touches no database and no network, so it can be tested on its
# own (tests/test_reliability_report.py).
#
# Look: the eHealth Africa slide decks, 16:9 landscape pages. A blue cover; light
# content pages with a small "01 / SECTION" tag, a large title, white cards,
# blue table headers and the eHA logo bottom-left with "Report title | page"
# bottom-right. The decks use Open Sans. If OpenSans-Regular.ttf and
# OpenSans-Bold.ttf are dropped into job_tracker/assets/fonts/ the report uses
# them; otherwise it uses Helvetica, which is built into every PDF reader, so
# nothing has to be installed for the report to work.

PAGE_W, PAGE_H = 720.0, 405.0
MARGIN = 36.0
TITLE = 'SDA Toolbox Reliability Report'

BLUE = HexColor('#0090FC')
INK = HexColor('#111418')
MUTED = HexColor('#4A5560')
BORDER = HexColor('#D5DCE3')
PAGE_BG = HexColor('#FAFCFF')
BLUE_SOFT = HexColor('#CCE9FE')
BLUE_MID = HexColor('#99D3FE')
LIME = HexColor('#EEF5A2')
LIME_EDGE = HexColor('#A9B32E')
RED_SOFT = HexColor('#FBDADB')
RED_EDGE = HexColor('#F4B4B6')
GOOD = HexColor('#38761D')
WARN = HexColor('#B87A00')
CRITICAL = HexColor('#B3261E')
ROW_ALT = HexColor('#F3F8FD')

_ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
_LOGO_COVER = os.path.join(_ASSETS, 'eha_logo_white.png')
_LOGO_FOOTER = os.path.join(_ASSETS, 'eha_logo.png')
_FONT_DIR = os.path.join(_ASSETS, 'fonts')

CATEGORY_LABELS = {
    'code_error': 'Code error',
    'resource': 'Resource limit',
    'dependency': 'Dependency down',
    'interrupted': 'Interrupted',
    'data_contract': 'Data check failed',
    'user_input': 'Bad input',
}
WINDOW_LABELS = {7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days'}

_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


# --- fonts -------------------------------------------------------------------

def _register_fonts() -> tuple[str, str]:
    """(regular, bold) font names. Open Sans when its files are bundled, else Helvetica."""
    regular = os.path.join(_FONT_DIR, 'OpenSans-Regular.ttf')
    bold = os.path.join(_FONT_DIR, 'OpenSans-Bold.ttf')
    if os.path.isfile(regular) and os.path.isfile(bold):
        try:
            if 'OpenSans' not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont('OpenSans', regular))
                pdfmetrics.registerFont(TTFont('OpenSans-Bold', bold))
            return 'OpenSans', 'OpenSans-Bold'
        except Exception:
            pass  # a damaged font file must not stop the report; fall through
    return 'Helvetica', 'Helvetica-Bold'


# --- formatting (mirrors src/frontend/src/utils/reliability.ts) ---------------

def format_pct(rate: Optional[float], digits: int = 1) -> str:
    return '-' if rate is None else f'{rate * 100:.{digits}f}%'


def format_seconds(seconds: Optional[float]) -> str:
    if seconds is None:
        return '-'
    s = max(0, int(round(seconds)))
    if s < 60:
        return f'{s}s'
    minutes = s // 60
    if minutes < 60:
        return f'{minutes}m'
    hours = minutes // 60
    if hours < 24:
        m = minutes % 60
        return f'{hours}h' if m == 0 else f'{hours}h {m}m'
    days, h = divmod(hours, 24)
    return f'{days}d' if h == 0 else f'{days}d {h}h'


def format_ms(ms: Optional[float]) -> str:
    if ms is None:
        return '-'
    if ms < 1000:
        return f'{round(ms)}ms'
    if ms < 60000:
        return f'{ms / 1000:.{1 if ms < 10000 else 0}f}s'
    if ms < 3600000:
        total = round(ms / 1000)
        m, s = divmod(total, 60)
        return f'{m}m' if s == 0 else f'{m}m {s}s'
    return format_seconds(ms / 1000)


def parse_iso(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        value = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def format_day(iso: Optional[str]) -> str:
    """'2026-10-14T09:30:00+00:00' or '2026-10-14' -> '14 Oct 2026' (UTC)."""
    value = parse_iso(iso)
    if value is None:
        return '-'
    value = value.astimezone(timezone.utc)
    return f'{value.day} {_MONTHS[value.month - 1]} {value.year}'


def format_stamp(iso: Optional[str]) -> str:
    value = parse_iso(iso)
    if value is None:
        return '-'
    value = value.astimezone(timezone.utc)
    return f'{value.day} {_MONTHS[value.month - 1]} {value.year}, {value:%H:%M} UTC'


def rate_tone(rate: Optional[float], target: float) -> Color:
    """Same thresholds as the page: at/above target good, within 3 points warning, else critical."""
    if rate is None:
        return MUTED
    if rate >= target:
        return GOOD
    if rate >= target - 0.03:
        return WARN
    return CRITICAL


def category_label(category: Optional[str]) -> str:
    if not category:
        return 'Uncategorised'
    return CATEGORY_LABELS.get(category, category.replace('_', ' '))


def verdict(overall: dict, target: float, days: int) -> str:
    rate = overall.get('success_rate')
    if rate is None:
        return f'No counted jobs ran in the last {days} days, so there is no success rate to report.'
    gap = (rate - target) * 100
    if rate >= target:
        return (f'The toolbox met its {format_pct(target, 0)} target: {format_pct(rate)} of counted jobs '
                f'succeeded in the last {days} days.')
    return (f'The toolbox missed its {format_pct(target, 0)} target by {abs(gap):.1f} points: '
            f'{format_pct(rate)} of counted jobs succeeded in the last {days} days.')


# --- drawing helpers ----------------------------------------------------------

class _Pen:
    """Wraps the canvas with the font choice and small text helpers."""

    def __init__(self, canv: pdf_canvas.Canvas, regular: str, bold: str):
        self.c = canv
        self.regular = regular
        self.bold = bold
        self.latin_only = regular == 'Helvetica'  # built-in fonts cannot draw every Unicode character

    def clean(self, text: Any) -> str:
        s = '' if text is None else str(text)
        s = ' '.join(s.split())
        if self.latin_only:
            s = s.encode('cp1252', 'replace').decode('cp1252')
        return s

    def width(self, text: str, size: float, bold: bool = False) -> float:
        return stringWidth(text, self.bold if bold else self.regular, size)

    def fit(self, text: Any, size: float, max_w: float, bold: bool = False) -> str:
        s = self.clean(text)
        if self.width(s, size, bold) <= max_w:
            return s
        ellipsis = '...'
        while s and self.width(s + ellipsis, size, bold) > max_w:
            s = s[:-1]
        return (s.rstrip() + ellipsis) if s else ellipsis

    def wrap(self, text: Any, size: float, max_w: float, max_lines: int, bold: bool = False) -> list[str]:
        words = self.clean(text).split(' ')
        lines: list[str] = []
        current = ''
        for word in words:
            trial = f'{current} {word}'.strip()
            if self.width(trial, size, bold) <= max_w:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        if len(lines) > max_lines:
            lines = lines[:max_lines]
            lines[-1] = self.fit(lines[-1] + ' ...', size, max_w, bold)
        return lines

    def text(self, x: float, y: float, text: Any, size: float = 10, color: Color = INK,
             bold: bool = False, align: str = 'l') -> None:
        c = self.c
        c.setFont(self.bold if bold else self.regular, size)
        c.setFillColor(color)
        s = self.clean(text)
        if align == 'r':
            c.drawRightString(x, y, s)
        elif align == 'c':
            c.drawCentredString(x, y, s)
        else:
            c.drawString(x, y, s)

    def card(self, x: float, y: float, w: float, h: float, fill: Color = white, edge: Color = BORDER,
             radius: float = 6) -> None:
        c = self.c
        c.setFillColor(fill)
        c.setStrokeColor(edge)
        c.setLineWidth(0.75)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=1)


class _Report:
    def __init__(self, buffer: io.BytesIO):
        regular, bold = _register_fonts()
        self.c = pdf_canvas.Canvas(buffer, pagesize=(PAGE_W, PAGE_H), pageCompression=1)
        self.c.setTitle(TITLE)
        self.c.setAuthor('eHealth Africa')
        self.c.setSubject('SDA Toolbox reliability over the chosen window')
        self.pen = _Pen(self.c, regular, bold)
        self.page = 0
        self.section = 0

    # -- page frames --
    def cover(self, window_label: str, span: str, generated: str) -> None:
        c, pen = self.c, self.pen
        self.page += 1
        c.setFillColor(BLUE)
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        if os.path.isfile(_LOGO_COVER):
            c.drawImage(_LOGO_COVER, MARGIN + 6, PAGE_H - 36 - 52, width=180, height=180 * 267 / 927,
                        mask='auto', preserveAspectRatio=True)
        else:
            pen.text(MARGIN + 6, PAGE_H - 70, 'eHealth Africa', 18, white, bold=True)
        pen.text(MARGIN + 6, 235, 'RELIABILITY REPORT', 10, BLUE_SOFT, bold=True)
        pen.text(MARGIN + 6, 196, 'SDA Toolbox', 40, white, bold=True)
        pen.text(MARGIN + 6, 156, 'Reliability Report', 40, white, bold=True)
        pen.text(MARGIN + 6, 112, f'{window_label}  |  {span}', 14, white)
        pen.text(MARGIN + 6, 44, f'Generated {generated}', 10, BLUE_SOFT)
        c.showPage()

    def content_page(self, title: str, sub: Optional[str] = None, continued: bool = False) -> None:
        """Start a light content page: background, section tag, title, footer."""
        c, pen = self.c, self.pen
        if not continued:
            self.section += 1
        self.page += 1
        c.setFillColor(PAGE_BG)
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        tag = f'{self.section:02d} / {title.upper()}'
        pen.text(MARGIN, PAGE_H - 40, tag + ('  (CONTINUED)' if continued else ''), 8.5, BLUE, bold=True)
        pen.text(MARGIN, PAGE_H - 68, sub or title, 20, INK, bold=True)
        # footer
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.5)
        c.line(MARGIN, 40, PAGE_W - MARGIN, 40)
        if os.path.isfile(_LOGO_FOOTER):
            c.drawImage(_LOGO_FOOTER, MARGIN, 14, width=70, height=70 * 267 / 927, mask='auto',
                        preserveAspectRatio=True)
        else:
            pen.text(MARGIN, 20, 'eHealth Africa', 8, MUTED, bold=True)
        pen.text(PAGE_W - MARGIN, 20, f'{TITLE}  |  {self.page}', 8, MUTED, align='r')

    def end_page(self) -> None:
        self.c.showPage()

    def note(self, text: str, y: float = 280) -> None:
        self.pen.card(MARGIN, y - 18, PAGE_W - 2 * MARGIN, 40, fill=white)
        self.pen.text(MARGIN + 14, y - 2, text, 10, MUTED)

    # -- table with header, zebra rows, pagination by the caller --
    def table(self, top: float, cols: list[tuple[str, float, str]], rows: list[list[Any]],
              row_h: float = 20, size: float = 8.5, tones: Optional[list[list[Optional[Color]]]] = None) -> None:
        """cols = [(heading, width, align)], widths in points summing to the table width."""
        c, pen = self.c, self.pen
        total_w = sum(w for _, w, _ in cols)
        head_h = 22
        c.setFillColor(BLUE)
        c.roundRect(MARGIN, top - head_h, total_w, head_h, 4, stroke=0, fill=1)
        x = MARGIN
        for heading, width, align in cols:
            tx = x + (width - 8 if align == 'r' else 8)
            pen.text(tx, top - 14.5, heading, 8, white, bold=True, align='r' if align == 'r' else 'l')
            x += width
        y = top - head_h
        for index, row in enumerate(rows):
            if index % 2 == 0:
                c.setFillColor(white)
            else:
                c.setFillColor(ROW_ALT)
            c.rect(MARGIN, y - row_h, total_w, row_h, stroke=0, fill=1)
            c.setStrokeColor(BORDER)
            c.setLineWidth(0.4)
            c.line(MARGIN, y - row_h, MARGIN + total_w, y - row_h)
            x = MARGIN
            for col_index, (value, (_, width, align)) in enumerate(zip(row, cols)):
                tone = tones[index][col_index] if tones and tones[index] and col_index < len(tones[index]) else None
                bold = tone is not None
                text = pen.fit(value, size, width - 16, bold)
                tx = x + (width - 8 if align == 'r' else 8)
                pen.text(tx, y - row_h + (row_h - size) / 2 + 1.5, text, size, tone or INK, bold=bold,
                         align='r' if align == 'r' else 'l')
                x += width
            y -= row_h


def _chunks(items: list, size: int) -> Iterable[list]:
    for start in range(0, max(len(items), 1), size):
        yield items[start:start + size]


# --- the pages -----------------------------------------------------------------

def _page_headline(rep: _Report, stats: dict, incidents_open: int) -> None:
    pen, c = rep.pen, rep.c
    overall, target = stats['overall'], stats['target']['success_rate']
    days = stats['window']['days']
    rep.content_page('Headline', 'Did the toolbox meet its target?')

    # verdict band (the lime highlight the decks use for the one sentence to remember)
    band_h = 34
    top = PAGE_H - 84
    pen.card(MARGIN, top - band_h, PAGE_W - 2 * MARGIN, band_h, fill=LIME, edge=LIME_EDGE, radius=5)
    lines = pen.wrap(verdict(overall, target, days), 10.5, PAGE_W - 2 * MARGIN - 24, 2, bold=True)
    for i, line in enumerate(lines):
        pen.text(MARGIN + 12, top - 14 - i * 13, line, 10.5, INK, bold=True)

    gap, tile_h = 14, 92
    tile_w = (PAGE_W - 2 * MARGIN - 3 * gap) / 4
    rate = overall['success_rate']
    mttr_sub = (f"median {format_seconds(overall['mttr_median_seconds'])}, p90 {format_seconds(overall['mttr_p90_seconds'])}"
                if overall['resolved_incidents'] else 'no incidents resolved')
    tiles = [
        ('SUCCESS RATE', format_pct(rate), f'target {format_pct(target, 0)}', rate_tone(rate, target)),
        ('JOBS RUN', f"{overall['total']:,}", f"{overall['completed']:,} completed", INK),
        ('COUNTED FAILURES', f"{overall['failed_counted']:,}", 'count against the target',
         CRITICAL if overall['failed_counted'] else INK),
        ('OPEN INCIDENTS', f'{incidents_open:,}', f"{overall['resolved_incidents']:,} resolved in window",
         CRITICAL if incidents_open else INK),
        ('MEDIAN RUN TIME', format_ms(overall['p50_ms']), 'completed jobs', INK),
        ('P95 RUN TIME', format_ms(overall['p95_ms']), 'slowest 1 in 20', INK),
        ('MEAN TIME TO REPAIR', format_seconds(overall['mttr_seconds']), mttr_sub, INK),
        ('EXCLUDED FAILURES', f"{overall['failed_excluded']:,}", 'bad input or data checks', INK),
    ]
    row_top = top - band_h - 14
    for index, (label, value, sub, color) in enumerate(tiles):
        col, row = index % 4, index // 4
        x = MARGIN + col * (tile_w + gap)
        y = row_top - row * (tile_h + gap) - tile_h
        pen.card(x, y, tile_w, tile_h, fill=white)
        pen.text(x + 12, y + tile_h - 18, label, 7.5, MUTED, bold=True)
        pen.text(x + 12, y + tile_h - 56, value, 26, color, bold=True)
        pen.text(x + 12, y + 12, pen.fit(sub, 8, tile_w - 24), 8, MUTED)
    rep.end_page()


def _page_trend(rep: _Report, stats: dict) -> None:
    pen, c = rep.pen, rep.c
    target = stats['target']['success_rate']
    daily = stats['daily']
    rep.content_page('Trend', 'Success rate by day and why jobs failed')

    # left card: success-rate line vs target
    top = PAGE_H - 84
    card_h = top - 52
    left_w = 388
    pen.card(MARGIN, 52, left_w, card_h, fill=white)
    pen.text(MARGIN + 14, top - 18, 'Success rate by day', 10, INK, bold=True)
    pen.text(MARGIN + 14, top - 31, f'Counted jobs only. Dashed line is the {format_pct(target, 0)} target. Days are UTC.',
             7.5, MUTED)

    plot_l, plot_r = MARGIN + 44, MARGIN + left_w - 16
    plot_t, plot_b = top - 48, 52 + 34
    rates = [d['success_rate'] for d in daily if d['success_rate'] is not None]
    if not rates:
        pen.text((plot_l + plot_r) / 2, (plot_t + plot_b) / 2, 'No counted jobs in this window', 10, MUTED, align='c')
    else:
        lo = max(0.0, int((min(min(rates), target) - 0.02) * 20) / 20)
        hi = 1.0
        span = hi - lo

        def ypos(value: float) -> float:
            return plot_b + (value - lo) / span * (plot_t - plot_b)

        # grid + y ticks
        for i in range(5):
            value = lo + span * i / 4
            y = ypos(value)
            c.setStrokeColor(BORDER)
            c.setLineWidth(0.4)
            c.line(plot_l, y, plot_r, y)
            pen.text(plot_l - 6, y - 3, f'{value * 100:.0f}%', 7.5, MUTED, align='r')
        # target line
        c.setStrokeColor(MUTED)
        c.setLineWidth(0.9)
        c.setDash(4, 3)
        c.line(plot_l, ypos(target), plot_r, ypos(target))
        c.setDash()
        n = len(daily)
        step = (plot_r - plot_l) / max(n - 1, 1)

        def xpos(i: int) -> float:
            return plot_l + i * step

        # line through consecutive days that have a rate; a gap where no counted job ran
        c.setStrokeColor(BLUE)
        c.setLineWidth(1.6)
        path = None
        for i, day in enumerate(daily):
            r = day['success_rate']
            if r is None:
                if path is not None:
                    c.drawPath(path, stroke=1, fill=0)
                    path = None
                continue
            if path is None:
                path = c.beginPath()
                path.moveTo(xpos(i), ypos(r))
            else:
                path.lineTo(xpos(i), ypos(r))
        if path is not None:
            c.drawPath(path, stroke=1, fill=0)
        # dots, red where a day is under target
        for i, day in enumerate(daily):
            r = day['success_rate']
            if r is None:
                continue
            c.setFillColor(CRITICAL if r < target else BLUE)
            c.setStrokeColor(white)
            c.setLineWidth(0.8)
            c.circle(xpos(i), ypos(r), 2.6 if n <= 31 else 1.9, stroke=1, fill=1)
        # x labels: first, last and a few between
        marks = sorted({0, n - 1, *(round(k * (n - 1) / 4) for k in range(1, 4))})
        for i in marks:
            pen.text(xpos(i), plot_b - 14, format_day(daily[i]['date'])[:-5], 7.5, MUTED, align='c')

    # right card: failure causes as horizontal bars
    rx = MARGIN + left_w + 12
    rw = PAGE_W - MARGIN - rx
    pen.card(rx, 52, rw, card_h, fill=white)
    pen.text(rx + 14, top - 18, 'Why jobs failed', 10, INK, bold=True)
    pen.text(rx + 14, top - 31, 'All failures in the window, by cause', 7.5, MUTED)
    cats = stats['by_category']
    if not cats:
        pen.text(rx + rw / 2, 52 + card_h / 2, 'No failures in this window', 9, MUTED, align='c')
    else:
        biggest = max(c_['count'] for c_ in cats) or 1
        y = top - 56
        bar_l = rx + 14
        bar_max = rw - 28 - 34
        for item in cats[:6]:
            pen.text(bar_l, y, category_label(item['category']), 8, INK)
            if not item['counted']:
                pen.text(rx + rw - 14, y, 'not counted', 7, MUTED, align='r')
            bar_y = y - 14
            length = max(2.0, bar_max * item['count'] / biggest)
            c.setFillColor(CRITICAL if item['counted'] else BLUE_MID)
            c.roundRect(bar_l, bar_y, length, 8, 2, stroke=0, fill=1)
            pen.text(bar_l + length + 5, bar_y, f"{item['count']:,}", 8, INK, bold=True)
            y -= 34
    rep.end_page()


def _page_tools(rep: _Report, stats: dict) -> None:
    pen = rep.pen
    target = stats['target']['success_rate']
    tools = stats['by_tool']
    cols = [('Tool', 168, 'l'), ('Jobs', 54, 'r'), ('Completed', 72, 'r'), ('Counted fails', 82, 'r'),
            ('Excluded', 64, 'r'), ('Success rate', 78, 'r'), ('p95 time', 62, 'r'), ('Last failure', 68, 'r')]
    per_page = 11
    chunks = list(_chunks(tools, per_page))
    for index, chunk in enumerate(chunks):
        rep.content_page('Reliability by tool', 'Reliability by tool, worst first', continued=index > 0)
        if not tools:
            rep.note('No tool runs were recorded in this window.')
            rep.end_page()
            continue
        rows, tones = [], []
        for t in chunk:
            rows.append([
                t['label'] or t['tool'], f"{t['total']:,}", f"{t['completed']:,}", f"{t['failed_counted']:,}",
                f"{t['failed_excluded']:,}", format_pct(t['success_rate']), format_ms(t['p95_ms']),
                format_day(t['last_failure_at']) if t['last_failure_at'] else '-',
            ])
            tones.append([None, None, None, CRITICAL if t['failed_counted'] else None, None,
                          rate_tone(t['success_rate'], target) if t['success_rate'] is not None else None])
        rep.table(PAGE_H - 84, cols, rows, row_h=21, tones=tones)
        rep.end_page()


def _page_causes(rep: _Report, stats: dict, labels: dict[str, str]) -> None:
    pen = rep.pen
    rep.content_page('Top causes', 'Most common crash causes')
    causes = stats['top_causes']
    if not causes:
        rep.note('No counted failures in this window, so there are no crash causes to list.')
        rep.end_page()
        return
    cols = [('Count', 44, 'r'), ('Tool', 92, 'l'), ('Category', 84, 'l'), ('Error', 88, 'l'),
            ('Last message', 266, 'l'), ('Last seen', 74, 'r')]
    rows = [[f"{c['count']:,}", labels.get(c['tool'], c['tool']), category_label(c['category']),
             c['error_type'] or 'Unknown', c['sample'] or '-', format_day(c['last_seen'])] for c in causes]
    rep.table(PAGE_H - 84, cols, rows, row_h=22)
    rep.end_page()


def _page_incidents(rep: _Report, incidents: list[dict], labels: dict[str, str]) -> None:
    pen = rep.pen
    cols = [('Opened', 70, 'l'), ('Tool', 88, 'l'), ('Incident', 192, 'l'), ('Severity', 54, 'l'),
            ('Status', 90, 'l'), ('Failures', 54, 'r'), ('Open for', 100, 'r')]
    chunks = list(_chunks(incidents, 10))
    for index, chunk in enumerate(chunks):
        rep.content_page('Incidents', 'Incidents in this window', continued=index > 0)
        if not incidents:
            rep.note('No incidents were opened or resolved in this window.')
            rep.end_page()
            continue
        rows, tones = [], []
        for inc in chunk:
            open_for = format_seconds(inc['duration_seconds'] if inc['status'] == 'resolved' else inc['age_seconds'])
            rows.append([format_day(inc['opened_at']), labels.get(inc['tool'], inc['tool']), inc['title'],
                         inc['severity'].upper(), inc['status'].capitalize(), f"{inc['failure_count']:,}", open_for])
            tones.append([None, None, None, CRITICAL if inc['severity'] == 'sev1' else None,
                          CRITICAL if inc['status'] == 'open' else (GOOD if inc['status'] == 'resolved' else WARN)])
        rep.table(PAGE_H - 84, cols, rows, row_h=22, tones=tones)
        rep.end_page()


def _page_failures(rep: _Report, failures: list[dict], labels: dict[str, str]) -> None:
    rep.content_page('Recent failures', 'Latest failed jobs')
    if not failures:
        rep.note('No failed jobs were recorded in this window.')
        rep.end_page()
        return
    cols = [('When (UTC)', 98, 'l'), ('Tool', 96, 'l'), ('Category', 92, 'l'), ('Counted', 50, 'l'),
            ('Run time', 56, 'r'), ('What happened', 256, 'l')]
    rows = []
    for job in failures[:11]:
        rows.append([
            format_stamp(job.get('started_at')).replace(' UTC', ''), labels.get(job['tool'], job['label'] or job['tool']),
            category_label(job.get('error_category')),
            'Yes' if is_counted(job.get('error_category')) else 'No',
            format_ms(job.get('duration_ms')), job.get('error_detail') or job.get('error') or job.get('error_type') or '-',
        ])
    rep.table(PAGE_H - 84, cols, rows, row_h=21)
    rep.end_page()


def _page_ready(rep: _Report, ready: Optional[dict]) -> None:
    pen = rep.pen
    rep.content_page('Backend readiness', 'Is the backend healthy right now?')
    if not ready:
        rep.note('The readiness checks could not be run when this report was made.')
        rep.end_page()
        return
    status = ready.get('status', 'unknown')
    tone = {'ready': GOOD, 'degraded': WARN}.get(status, CRITICAL)
    uptime = ready.get('uptime_seconds')
    pen.text(MARGIN, PAGE_H - 90, status.replace('_', ' ').upper(), 12, tone, bold=True)
    pen.text(MARGIN + 100, PAGE_H - 90, f"Up for {format_seconds(uptime)} | checked when the report was made", 9, MUTED)
    cols = [('Check', 120, 'l'), ('Result', 60, 'l'), ('Kind', 74, 'l'), ('Time', 56, 'r'), ('Detail', 338, 'l')]
    rows, tones = [], []
    for check in ready.get('checks', []):
        rows.append([check['name'].replace('_', ' '), 'OK' if check['ok'] else 'FAILED',
                     'Critical' if check['critical'] else 'Advisory',
                     format_ms(check.get('ms')), check.get('detail') or '-'])
        tones.append([None, GOOD if check['ok'] else CRITICAL])
    rep.table(PAGE_H - 102, cols, rows, row_h=24)
    rep.end_page()


# --- entry point --------------------------------------------------------------------

def build_report_pdf(
    stats: dict[str, Any],
    incidents: list[dict[str, Any]],
    failed_jobs: list[dict[str, Any]],
    ready: Optional[dict[str, Any]] = None,
    generated_at: Optional[datetime] = None,
) -> bytes:
    """Render the reliability report and return the PDF bytes.

    `stats` is stats.compute_stats()'s result for the chosen window; the other
    arguments are the lists the Reliability page loads next to it. `incidents`
    and `failed_jobs` are used as given: the caller decides what is "in the
    window" (see window_filter helpers in router.py)."""
    generated_at = generated_at or datetime.now(timezone.utc)
    days = stats['window']['days']
    labels = {t['tool']: t['label'] for t in stats['by_tool']}
    for job in failed_jobs:
        labels.setdefault(job['tool'], job.get('label') or job['tool'])

    buffer = io.BytesIO()
    rep = _Report(buffer)
    span = f"{format_day(stats['window']['from'])} to {format_day(stats['window']['to'])}"
    rep.cover(WINDOW_LABELS.get(days, f'Last {days} days'), span, format_stamp(generated_at.isoformat()))
    _page_headline(rep, stats, stats['overall']['open_incidents'])
    _page_trend(rep, stats)
    _page_tools(rep, stats)
    _page_causes(rep, stats, labels)
    _page_incidents(rep, incidents, labels)
    _page_failures(rep, failed_jobs, labels)
    _page_ready(rep, ready)
    rep.c.save()
    return buffer.getvalue()
