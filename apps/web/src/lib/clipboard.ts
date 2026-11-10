import { notifyError, notifySuccess } from './api'

/** Copies text. `navigator.clipboard` only exists in secure contexts, and http://one-desk.local is not one. */
export async function copyText(text: string, done = 'Link disalin') {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text)
    else {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      if (!ok) throw new Error('copy failed')
    }
    notifySuccess(done)
  } catch {
    notifyError(new Error('Gagal menyalin link'))
  }
}

/** Only http(s) URLs from external systems are rendered as links. */
export const isHttpUrl = (url: string) => /^https?:\/\//i.test(url)
