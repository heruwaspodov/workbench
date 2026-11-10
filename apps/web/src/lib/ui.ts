import { css } from '@mekari/pixel3'

/**
 * One look for every surface in the app. Pages compose these instead of defining their own cards,
 * so borders, radii, shadows and spacing stay identical everywhere.
 */
export const ui = {
  /** White card on the grey canvas. */
  card: css({ bg: 'background.stage', rounded: 'xl', borderWidth: '1px', borderColor: 'border.default.subtle', p: '5' }),
  /** Add to a card that is a link or button: it lifts 2px on hover. */
  lift: css({
    transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease', textDecoration: 'none', color: 'inherit', cursor: 'pointer',
    _hover: { transform: 'translateY(-2px)', shadow: 'md', borderColor: 'border.default' },
  }),
  /** Frame for lists and editors: bordered, content clipped to the rounded corners. */
  panel: css({ bg: 'background.stage', rounded: 'xl', borderWidth: '1px', borderColor: 'border.default.subtle', overflow: 'hidden' }),
  /** Wrapper for a data table: flat, like the table sits directly on the page. */
  flat: css({ overflow: 'hidden' }),
  /** Row of filters above a list. */
  toolbar: css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '3', mb: '5' }),
  /** Fixed-width slot so selects and inputs do not stretch across the page. */
  field: css({ width: '220px' }),
  fieldWide: css({ width: '280px' }),
  /**
   * Data tables. Pixel renders body cells as semibold <th>, so plain-text cells looked bold next to MpText cells;
   * this puts every cell on one weight, one padding and one hairline, with a quiet header.
   */
  table: css({
    width: '100%', fontSize: 'md',
    '& thead th': {
      bg: 'background.surface', color: 'text.primary', fontSize: 'md', fontWeight: 'semiBold', py: '14px', px: '4', textAlign: 'left',
      whiteSpace: 'nowrap', borderBottomWidth: '1px', borderColor: 'border.default.subtle',
    },
    '& tbody th, & tbody td': {
      bg: 'transparent', fontWeight: 'normal', color: 'text.primary', py: '14px', px: '4', verticalAlign: 'middle', textAlign: 'left',
      borderBottomWidth: '1px', borderColor: 'border.default.subtle',
    },
    '& tbody tr:last-child th, & tbody tr:last-child td': { borderBottomWidth: '0' },
    '& tbody tr:hover > *': { bg: 'background.surface' },
  }),
  /** Same look for the spreadsheet-style editor: cells hold inputs, so content aligns to the top. */
  tableDense: css({
    width: '100%', fontSize: 'md',
    '& thead th': { color: 'text.secondary', fontSize: 'sm', fontWeight: 'semiBold', py: '3', px: '3', textAlign: 'left', whiteSpace: 'nowrap', borderBottomWidth: '1px', borderColor: 'border.default.subtle' },
    '& tbody th, & tbody td': { bg: 'transparent', fontWeight: 'normal', color: 'text.primary', py: '3', px: '3', verticalAlign: 'top', textAlign: 'left', borderBottomWidth: '1px', borderColor: 'border.default.subtle' },
    '& tbody tr:last-child th, & tbody tr:last-child td': { borderBottomWidth: '0' },
  }),
  row: css({ display: 'flex', alignItems: 'center', gap: '3' }),
  between: css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' }),
  stack: css({ display: 'flex', flexDirection: 'column', gap: '3' }),
  /** Section heading inside a page. */
  section: css({ mt: '8', mb: '3' }),
  cards: css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '4' }),
  twoCol: css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', xl: 'repeat(2, minmax(0, 1fr))' }, gap: '5', alignItems: 'start' }),
  link: css({ color: 'text.link', fontWeight: 'semiBold', textDecoration: 'none', _hover: { textDecoration: 'underline' } }),
  /** Compact list: one block per record, hairline separators, hover tint (pull requests, Confluence, PGP). */
  list: css({ borderTopWidth: '1px', borderColor: 'border.default.subtle' }),
  listRow: css({
    display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', columnGap: '3', alignItems: 'center', px: '4', py: '3',
    borderBottomWidth: '1px', borderColor: 'border.default.subtle', textDecoration: 'none', color: 'inherit',
    _hover: { bg: 'background.surface' }, _focusVisible: { outline: '2px solid', outlineColor: 'border.focused', outlineOffset: '-2px' },
  }),
  /** Round tile that holds the row's icon. */
  tile: css({ width: '9', height: '9', rounded: 'full', bg: 'background.surface', display: 'grid', placeItems: 'center', flexShrink: 0 }),
  /** Light inset box for a short note or a selected item. */
  note: css({ bg: 'background.surface', rounded: 'lg', p: '3' }),
}
