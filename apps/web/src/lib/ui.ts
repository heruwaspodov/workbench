import { css } from '@mekari/pixel3'

/**
 * One look for every surface in the app. Pages compose these instead of defining their own cards,
 * so borders, radii, shadows and spacing stay identical everywhere.
 */
export const ui = {
  /** White card on the grey canvas. */
  card: css({ bg: 'background.stage', rounded: 'xl', borderWidth: '1px', borderColor: 'border.default.subtle', shadow: 'xs', p: '5' }),
  /** Add to a card that is a link or button: it lifts 2px on hover. */
  lift: css({
    transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease', textDecoration: 'none', color: 'inherit', cursor: 'pointer',
    _hover: { transform: 'translateY(-2px)', shadow: 'md', borderColor: 'border.default' },
  }),
  /** Frame for tables and lists: no padding, content clipped to the rounded corners. */
  panel: css({ bg: 'background.stage', rounded: 'xl', borderWidth: '1px', borderColor: 'border.default.subtle', shadow: 'xs', overflow: 'hidden' }),
  /** Row of filters above a list. */
  toolbar: css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '3', mb: '5' }),
  /** Fixed-width slot so selects and inputs do not stretch across the page. */
  field: css({ width: '200px' }),
  fieldWide: css({ width: '280px' }),
  row: css({ display: 'flex', alignItems: 'center', gap: '3' }),
  between: css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3' }),
  stack: css({ display: 'flex', flexDirection: 'column', gap: '3' }),
  /** Section heading inside a page. */
  section: css({ mt: '8', mb: '3' }),
  cards: css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '4' }),
  twoCol: css({ display: 'grid', gridTemplateColumns: { base: 'minmax(0, 1fr)', xl: 'repeat(2, minmax(0, 1fr))' }, gap: '5', alignItems: 'start' }),
  link: css({ color: 'text.link', fontWeight: 'semiBold', textDecoration: 'none', _hover: { textDecoration: 'underline' } }),
  /** Light inset box for a short note or a selected item. */
  note: css({ bg: 'background.surface', rounded: 'lg', p: '3' }),
}
