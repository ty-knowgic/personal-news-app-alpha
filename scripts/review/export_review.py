#!/usr/bin/env python3
"""
翻訳の確認シートを書き出す（開発用）。言語ごとに1つの Excel ファイル（review/<言語>.xlsx）を作り、
母語話者に渡して、訳の確認・修正をしてもらう。返ってきたファイルは import_review.py で取り込む。

使い方: python3 scripts/review/export_review.py [言語 ...]   （言語を省略するとすべて）
"""
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule

ROOT = Path(__file__).resolve().parents[2]
LOCALES = ROOT / 'public' / 'locales'
OUT = ROOT / 'review'

LANGUAGE_NAMES = {
    'id': 'Bahasa Indonesia (Indonesian)', 'ms': 'Bahasa Melayu (Malay)', 'th': 'ไทย (Thai)',
    'vi': 'Tiếng Việt (Vietnamese)', 'fil': 'Filipino', 'zh-Hans': '简体中文 (Simplified Chinese)',
    'zh-Hant': '繁體中文 (Traditional Chinese)', 'fr': 'Français (French)', 'es': 'Español (Spanish)',
    'de': 'Deutsch (German)', 'pt': 'Português (Portuguese)',
}

# 画面のどの部分の文言か（en.json の並び順で、この文言から次の区切りまでが同じ区分）
AREAS = [
    ('戻る', 'Header, list and filters'),
    ('政府・自治体', 'Publisher types (filter and badges)'),
    ('政治', 'News categories (tabs)'),
    ('日本', 'Regions'),
    ('連邦政府・オンタリオ州・ウォータールー地域の自治体', 'Region and category choices (descriptions and counts)'),
    ('ウォータールー周辺', 'Default interest topic names'),
    ('AI要約', 'News cards and daily briefing'),
    ('発信元ページの本文', 'Article page and summaries'),
    ('質問 {step} / 2', 'First-run questions'),
    ('低', 'Settings screen'),
    ('情報源の一覧を取得できませんでした。', 'Error messages and language picker'),
]

# 訳す人への補足（英語の文言 → 説明）
NOTES = {
    'Publisher': 'The organization that issued the announcement (a government body, company, research institute or NPO). Not a news publisher.',
    'All publishers': 'Filter option. Same meaning of “publisher” as above.',
    'My News': 'Name of the personalized tab: articles that match the user’s own interests. Used as a tab label, so keep it short.',
    'All My News': 'Heading above the full list on the My News tab.',
    'Interests': 'The user’s personal interest topics (what they want to follow).',
    'Sources': 'The websites/feeds the app collects from (e.g. a ministry or a company newsroom).',
    'Today’s briefing': 'A short digest of the day’s top stories, shown at the top of My News.',
    'Recent briefing': 'Same as above, when there are few stories in the last 24 hours.',
    'Summary': 'A short summary of one article.',
    'AI summary': 'A summary written by an AI model. Must be clearly different from the plain “Summary”, which is extracted text.',
    'Physical AI & robotics': 'Topic name. “Physical AI” means AI that acts in the physical world (robots, autonomous vehicles).',
    'Generative AI': 'Topic and category name.',
    'Org': 'Very short badge on a card for an organization/NPO publisher. Keep it to a few characters.',
    'Research': 'Very short badge on a card for a research institute publisher. Keep it to a few characters.',
    'Add interest topics or keywords in {link}.': '{link} is replaced by a clickable word meaning “Settings” (the translation of the word “Settings” from this sheet). Make sure the sentence reads naturally with that word inserted.',
    'New announcements for {scope} will appear here.': '{scope} is replaced by a short list such as “My News · Canada”. Make sure it reads naturally.',
    'Interests marked with “≈”, like {chip}, matched by meaning rather than keywords. Matching runs on the embedding model ({model}) on this server; no external AI service is used.': '{chip} is replaced by a small label showing a topic name (e.g. “Generative AI”). “≈” is a symbol shown next to topics matched by meaning. Keep “≈”.',
    'Must also contain one of “{words}{more}”': '{words} is a list of keywords; {more} is “…” if the list is cut short.',
    'Summary written by AI ({model}) based only on {source}. It may contain errors, so check the original for anything important.': '{source} is replaced by one of: “the publisher’s page”, “the PDF published by the publisher”, “the publisher’s feed text…”, “the publisher’s text” (see those rows). The sentence must work with each of them.',
    'Key sentences are extracted verbatim from {source} (not rewritten by AI).': '{source} is replaced by one of the “the publisher’s …” phrases (see those rows).',
    'the publisher’s page': 'Inserted into the sentence “Summary written by AI … based only on {source}”. Write it so it fits grammatically in that sentence.',
    'the PDF published by the publisher': 'Inserted into the same sentences as above.',
    'the publisher’s feed text (the full page could not be fetched)': 'Inserted into the same sentences as above.',
    'the publisher’s text': 'Inserted into the same sentences as above.',
    'Use {name}': 'Accessibility label for an on/off switch next to a source name. {name} is the source name.',
    'Open the {name} site': 'Accessibility label for a link icon next to a source name.',
    'Using <strong>{enabled}</strong> of {available} sources in the selected regions': 'The <strong>…</strong> tags make the number bold. Keep the tags and put them around the number.',
    'Question {step} / 2': 'First-run screen. {step} is 1 or 2.',
    ' You can choose several.': 'Appended directly after the previous sentence on the same line; keep a leading space if your language needs one.',
    ' and others': 'Appended after a short list of publisher names (e.g. “A・B and others”). Keep any leading space if needed.',
    ' +{n} more': 'Appended after a publisher name, e.g. “Government of Canada +1 more”. Keep any leading space if needed.',
    ' · “{keyword}”': 'Appended to the result count, e.g. “303 items · “climate””. Keep the quotes style normal for your language.',
    '{n} Japanese keywords are hidden in this view but are still used. Switch to Japanese to edit them.': 'Shown in a topic editor when the app is not in Japanese: some of the topic’s keywords are in Japanese and are hidden.',
    'Choose a language': 'Accessibility label for the language drop-down.',
    'Language': 'Heading of the language setting.',
    'Matched by meaning, not keywords': 'Tooltip on a small topic label.',
    'Follow-up from the same publisher': 'Shown on a card when related stories come from the same publisher.',
    'Waterloo area': 'Topic name for the Waterloo (Ontario, Canada) area. Keep the place name in a form people recognize.',
}

GLOSSARY = [
    ('My News', 'マイニュース'), ('Today’s briefing', '今日のブリーフィング'), ('Interests', '関心トピック'),
    ('Publisher', '発信元'), ('Sources', '情報源'), ('Summary', '要約'), ('AI summary', 'AI要約'),
    ('Region', '地域'), ('Topics', '分野'), ('Government', '政府・自治体'), ('Companies', '企業'),
    ('Research institutes', '研究機関'), ('Organizations & NPOs', '団体・NPO'), ('Priority', '優先度'),
    ('Related announcements', '関連する発表・報道'), ('Generative AI', '生成AI'),
    ('Physical AI & robotics', 'Physical AI・ロボット'), ('Settings', '設定'),
]

PLACEHOLDER = __import__('re').compile(r'\{\w+\}|</?\w+>|≈')


def area_for(keys):
    index = {}
    current = AREAS[0][1]
    marks = {key: name for key, name in AREAS}
    for key in keys:
        current = marks.get(key, current)
        index[key] = current
    return index


def forms(value):
    return [('', value)] if isinstance(value, str) else list(value.items())


def build(code):
    en = json.loads((LOCALES / 'en.json').read_text(encoding='utf-8'))
    tr = json.loads((LOCALES / f'{code}.json').read_text(encoding='utf-8'))
    areas = area_for(list(en))
    name = LANGUAGE_NAMES[code]

    wb = Workbook()
    head = Font(bold=True, color='FFFFFF')
    head_fill = PatternFill('solid', fgColor='4B4BB5')
    wrap = Alignment(wrap_text=True, vertical='top')

    # --- Read me
    ws = wb.active
    ws.title = 'Read me'
    lines = [
        (f'Sivry — translation review ({name})', True),
        ('', False),
        ('About the app', True),
        ('Sivry is a personal news app. It collects announcements that governments, companies, research institutes and NPOs publish themselves (primary sources only — no news-media articles), and shows the ones that match each user’s interests. It is meant for people in Japan, Canada, the US, Europe and ASEAN countries.', False),
        ('', False),
        ('What we ask you to do', True),
        ('1. Open the “Review” sheet. Each row is one piece of text shown in the app: the English original and our draft translation. The drafts were written by an AI assistant and have NOT yet been checked by a native speaker.', False),
        ('2. For every row choose OK or Needs change in the “Verdict” column. If it needs a change, type the better wording in “Corrected translation” (and, if you like, a short reason in “Comment”).', False),
        ('3. Check the “Glossary” sheet first. These terms appear throughout the app; please make sure they are natural and used consistently.', False),
        ('4. Return the file. Please do not rename, delete or reorder rows or sheets (the hidden first column is used to load your corrections).', False),
        ('', False),
        ('Rules for the translation', True),
        ('• Keep placeholders exactly as they are, e.g. {n}, {source}, {name}. They are replaced by numbers or names in the app. You may move them to wherever your grammar needs them.', False),
        ('• Keep HTML tags such as <strong>…</strong> and the symbol ≈ unchanged.', False),
        ('• Write for everyday users: natural, polite but not stiff, consistent with how popular apps in your language speak. Prefer the common local word over a literal translation.', False),
        ('• Keep it about as short as the English; many texts are buttons, tabs and labels on a phone screen.', False),
        ('• Plural forms: some rows say “(plural form: one / other)”. Provide the wording for exactly that form. Languages without plural forms have a single row.', False),
        ('• Proper names (ministries, companies, product names) stay as in the English text.', False),
        ('• Dates, “5 minutes ago” and number formats are produced automatically; you do not need to translate them.', False),
        ('• Some rows are only visible to screen-reader users (“accessibility label”). Translate them too.', False),
        ('', False),
        ('Not translated on purpose: article titles and summaries (they stay in the publisher’s language).', False),
    ]
    for i, (text, bold) in enumerate(lines, start=1):
        cell = ws.cell(row=i, column=1, value=text)
        cell.alignment = wrap
        if bold:
            cell.font = Font(bold=True, size=13 if i == 1 else 11)
    ws.column_dimensions['A'].width = 120

    # --- Glossary
    gs = wb.create_sheet('Glossary')
    gs.append(['English term', f'Draft term ({name})', 'Your preferred term (if different)', 'Comment'])
    for cell in gs[1]:
        cell.font, cell.fill = head, head_fill
    for english, key in GLOSSARY:
        value = tr[key]
        gs.append([english, value if isinstance(value, str) else value.get('other', ''), '', ''])
    for letter, width in zip('ABCD', (30, 36, 36, 40)):
        gs.column_dimensions[letter].width = width
    for row in gs.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = wrap
    gs.freeze_panes = 'A2'

    # --- Review
    rs = wb.create_sheet('Review')
    header = ['ID', '#', 'Where it appears', 'English (original)', f'Draft translation ({name})', 'Keep unchanged', 'Verdict', 'Corrected translation', 'Comment / reason', 'Notes for reviewer']
    rs.append(header)
    for cell in rs[1]:
        cell.font, cell.fill = head, head_fill
        cell.alignment = Alignment(wrap_text=True, vertical='center')
    number = 0
    for key, source in en.items():
        source_forms = forms(source)
        translated = tr[key]
        translated_forms = dict(forms(translated))
        for form, english in source_forms:
            # 訳側の複数形の区分は言語ごとに違うため、訳にある区分をそのまま並べる
            pass
        if isinstance(translated, str) and isinstance(source, dict):
            rows = [('', source['other'], translated)]
        elif isinstance(translated, dict):
            rows = [(f, source.get(f, source['other']) if isinstance(source, dict) else source, v) for f, v in translated.items()]
        else:
            rows = [('', source if isinstance(source, str) else source['other'], translated)]
        for form, english, draft in rows:
            number += 1
            label = f' (plural form: {form})' if form else ''
            note = NOTES.get(english.strip() if english.strip() in NOTES else english, NOTES.get(english, ''))
            rs.append([f'{key}|{form}', number, areas[key] + label, english, draft, ', '.join(dict.fromkeys(PLACEHOLDER.findall(english))), '', '', '', note])
    widths = {'A': 4, 'B': 5, 'C': 26, 'D': 48, 'E': 52, 'F': 16, 'G': 14, 'H': 52, 'I': 34, 'J': 48}
    for letter, width in widths.items():
        rs.column_dimensions[letter].width = width
    rs.column_dimensions['A'].hidden = True
    for row in rs.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = wrap
    for row in range(2, rs.max_row + 1):
        for column in 'GH':
            rs[f'{column}{row}'].fill = PatternFill('solid', fgColor='FFF9DB')
    validation = DataValidation(type='list', formula1='"OK,Needs change"', allow_blank=True)
    rs.add_data_validation(validation)
    validation.add(f'G2:G{rs.max_row}')
    rs.conditional_formatting.add(f'A2:J{rs.max_row}', FormulaRule(formula=['$G2="Needs change"'], fill=PatternFill('solid', bgColor='FFE0E0')))
    rs.freeze_panes = 'E2'
    rs.auto_filter.ref = f'A1:J{rs.max_row}'

    OUT.mkdir(exist_ok=True)
    path = OUT / f'sivry-review-{code}.xlsx'
    wb.save(path)
    return path, number


def main():
    available = sorted(path.stem for path in LOCALES.glob('*.json') if path.stem not in ('en', 'sources'))
    codes = sys.argv[1:] or available
    for code in codes:
        if code not in available:
            raise SystemExit(f'未対応の言語: {code}（{", ".join(available)}）')
        path, count = build(code)
        print(f'{code}: {count} 行 → {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
